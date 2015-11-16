require("node-polyfill");

var _ = require("underscore");
var $ = require("jquery");
var q = require("q");
var Observe = require("observe-js");
var Queue = require("./queue.js");
var shared = require("./shared.js");
var config = require("./config.js");
var traverse = require("traverse");
var ObjectPath = require("object-path");
var extend = require("node.extend");

var Store = Object.extend({
    initialize:function(options) {
        this.graph = {};
        return this;
    },
    upgradeEntityProxy:function(entityProxy, options) {
        var guid = shared.Entity.getGuid(entityProxy);
        var trackedEntity = this.graph[guid];
        if (!trackedEntity) {
            trackedEntity = entityProxy;
            this.graph[guid] = trackedEntity;
        }
        return trackedEntity;
    },
    discardObservations:function(root, options) {
        traverse(root).forEach(function(value) {
            if (this.key===config.syntax.observerKey) {
                value.discardChanges();
            }
        })
    },
    closeObservers:function(root, options) {
        traverse(root).forEach(function(value) {
            if (this.key===config.syntax.observerKey) {
                value.close();
            }
        })
    },
    put:function(data, options) {
        var guid = shared.Entity.getGuid(data);
        if (!guid) {
            throw "Cannot put data in store because a guid could not be determined.";
        }
        var entity = this.graph[guid];
        var patchMode;
        if (!entity) {
            entity = shared.Entity.getProxy(data);
            patchMode = shared.Entity.PATCH_MODE_REPLACE;
            this.graph[guid] = entity;
        }
        else {
            patchMode = shared.Entity.getPatchMode(entity, data);
        }
        if (patchMode===shared.Entity.PATCH_MODE_NONE) {
            throw "Cannot put data in store because data and entity versions are not compatible.";
        }
        else if (patchMode===shared.Entity.PATCH_MODE_REPLACE) {
            var resource = shared.Resource.forEntity(entity);
            this.closeObservers(entity);
            shared.Entity.strip(entity);
            if (resource) {
                extend(true, entity, resource.template);
            }
            this.buildObservers(entity, "");
        }
        for (var key in data) {
            if (key===config.syntax.idKey||key===config.syntax.metaKey) {
                continue;
            }
            var path = Observe.Path.get(key);
            var value = data[key];
            if (_.isArray(value)) {
                value.forEach(function(splice) {
                    var index = splice[0];
                    var removedCount = splice[1];
                    var addedValues = splice[2].map(function(addedValue) {
                        if (shared.Entity.isEntity(addedValue)) {
                            return this.upgradeEntityProxy(addedValue);
                        }
                        else {
                            return addedValue;
                        }
                    }.bind(this));
                    shared.Entity.getValueAtPath(entity, key).splice(index, removedCount, addedValues);
                }.bind(this))
            }
            else {
                if (value===config.syntax.deletionToken) {
                    shared.Entity.setValueAtPath(entity, key, undefined);
                }
                else if (_.isObject(value)) {
                    if (shared.Entity.isEntity(value)) {
                        shared.Entity.setValueAtPath(entity, key, this.upgradeEntityProxy(value));
                    }
                    else {
                        extend(true, shared.Entity.getOrCreateValueAtPath(entity, key, {}), value);
                    }
                }
                else {
                    shared.Entity.setValueAtPath(entity, key, value);
                }
            }
        }
        this.discardObservations(entity);
        Platform.performMicrotaskCheckpoint();
        return q(entity);
    },
    get:function(data, options) {
        var query = data.query;
        var guid = shared.Resource.buildGuid(query[config.syntax.idKey], data[config.syntax.metaKey][config.syntax.resourceKey]);
        if (guid in this.graph) {
            return this.graph[guid]
        }
        else {
            return undefined;
        }
    },
    buildObservers:function(entity, path, options) {
        var target = shared.Entity.getValueAtPath(entity, path);
        if (_.isArray(target)) {
            var metadata = shared.Entity.getOrCreateValueAtPath(target, config.syntax.metaKey, {});
            metadata[config.syntax.observerKey] = this.buildArrayObserver(entity, path);
            target.forEach(function(element, index) {
                this.buildObservers(entity, extendedPath+"["+index+"]");
            }.bind(this))
        }
        else if (_.isObject(target)) {
            if (shared.Entity.isEntity(target)&&target!==entity) {
                return;
            }
            var metadata = shared.Entity.getOrCreateValueAtPath(target, config.syntax.metaKey, {});
            metadata[config.syntax.observerKey] = this.buildObjectObserver(entity, path);
            for (var key in target) {
                if (key===config.syntax.idKey||key===config.syntax.metaKey) {
                    continue;
                }
                var extendedPath = shared.Path.joinPath(path, key);
                this.buildObservers(entity, extendedPath);
            }
        }
    },
    buildObjectObserver:function(entity, path, options) {
        var object = shared.Entity.getValueAtPath(entity, path);
        var observer = new Observe.ObjectObserver(object);
        var resource = shared.Resource.forEntity(entity);
        observer.open(function(added, removed, changed, getOldValue) {
            var patchData = {};
            var valid = true;
            var add = function(value, key) {
                var extendedPath = shared.Path.joinPath(path, key);
                var validation = resource.validate(extendedPath, value);
                if (validation.state===shared.Resource.validationStates.valid) {
                    if (shared.Entity.isEntity(value)) {
                        patchData[extendedPath] = shared.Entity.getProxy(value);
                    }
                    else {
                        patchData[extendedPath] = value;
                        this.buildObservers(entity, extendedPath);
                    }
                }
                else {
                    valid = false;
                }
                ObjectPath.set(entity, shared.Path.joinPath(shared.Path.buildMetadataPath(extendedPath), config.syntax.validationPath), validation);
            }.bind(this);
            var change = function(value, key) {
                var extendedPath = shared.Path.joinPath(path, key);
                var oldValue = getOldValue(key);
                this.closeObservers(oldValue);
                var validation = resource.validate(extendedPath, value);
                if (validation.state===shared.Resource.validationStates.valid) {
                    if (shared.Entity.isEntity(value)) {
                        patchData[extendedPath] = shared.Entity.getProxy(value);
                    }
                    else {
                        patchData[extendedPath] = value;
                        this.buildObservers(entity, extendedPath);
                    }
                }
                else {
                    valid = false;
                }
                ObjectPath.set(entity, shared.Path.joinPath(shared.Path.buildMetadataPath(extendedPath), config.syntax.validationPath), validation);
            }.bind(this);
            var remove = function(value, key) {
                var extendedPath = shared.Path.joinPath(path, key);
                var validation = resource.validate(extendedPath, undefined);
                if (validation.state===shared.Resource.validationStates.valid) {
                    var oldValue = getOldValue(key);
                    this.closeObservers(oldValue);
                    patchData[extendedPath] = config.syntax.deletionToken;
                }
                else {
                    valid = false;
                }
                ObjectPath.set(entity, shared.Path.joinPath(shared.Path.buildMetadataPath(extendedPath), config.syntax.validationPath), validation);
            }.bind(this);

            _.each(added, add);
            _.each(changed, change);
            _.each(removed, remove);

            if (valid) {
                patchData[config.syntax.idKey] = entity[config.syntax.idKey];
                patchData[config.syntax.metaKey] = _.pick(entity[config.syntax.metaKey], config.syntax.resourceKey, config.syntax.versionKey);
                dispatcher.queueOutbound({
                    patch:patchData
                });
            }
        }.bind(this));
        return observer;
    },
    buildArrayObserver:function(entity, path, options) {
        var array = shared.Entity.getValueAtPath(entity, path);
        var observer = new Observe.ArrayObserver(array);
        observer.open(function(splices) {
            var patchData = {};
            patchData[path] = splices.map(function(splice) {
                var index = splice.index;
                var removed = splice.removed;
                var added = array.slice(index, index+splice.addedCount);
                removed.forEach(function(element) {
                    if (shared.Entity.isEntity(element)) {
                    }
                    else {
                        this.closeObservers(element);
                    }
                }.bind(this))
                return [
                    index,
                    removed.length,
                    added.map(function(element, offset) {
                        if (shared.Entity.isEntity(element)) {
                            return shared.Entity.getProxy(element);
                        }
                        else {
                            this.buildObservers(entity, path+"["+(index+offset)+"]");
                            return element;
                        }
                    }.bind(this))
                ]
            }.bind(this))
            patchData[config.syntax.idKey] = entity[config.syntax.idKey];
            patchData[config.syntax.metaKey] = _.pick(entity[config.syntax.metaKey], config.syntax.resourceKey, config.syntax.versionKey);
            dispatcher.queueOutbound({
                patch:patchData
            });
        }.bind(this));
        return observer;
    },
    track:function(entity, options) {
        if (!shared.Entity.isEntity(entity)) {
            throw "Cannot track non-entity objects.";
        }
        var guid = shared.Entity.getGuid(entity);
        if (guid in this.graph) {
            if (this.graph[guid]===entity) {
                console.log("Entity with GUID "+guid+" is already being tracked.");
            }
            else {
                throw "Cannot track entity with GUID "+guid+" because it is already being tracked and is not referentially equal to the entity already in the store.";
            }
        }
        this.graph[guid] = entity;
        this.buildObservers(entity, "");
    },
    untrack:function(entity, options) {
        if (!shared.Entity.isEntity(entity)) {
            throw "Cannot untrack non-entity objects.";
        }
        var guid = shared.Entity.getGuid(entity);
        if (guid in this.graph) {
            console.log("Attempted to untrack an entity with GUID "+guid+" that is not being tracked.");
            return;
        }
        this.closeObservers(entity);
        delete this.graph[guid];
    }
})
var store = module.exports.store = Store.new();

var Dispatcher = Object.extend({
    initialize:function(options) {
        this.inQueue = Queue.new();
        this.outQueue = Queue.new();
        return this;
    },
    setEndpoint:function(endpoint) {
        this.endpoint = endpoint;
    },
    queueOutbound:function(operation, options) {
        var deferred = q.defer();
        this.outQueue.enqueue({
            operation:operation,
            deferred:deferred
        });
        // TODO add more configurability here so all changes are not immediately flushed
        this.flushOutbound();
        return deferred.promise;
    },
    queueInbound:function(operation, options) {
        var deferred = q.defer();
        this.inQueue.enqueue({
            operation:operation,
            deferred:deferred
        });
        return deferred.promise;
    },
    flushOutbound:function(options) {
        var items = this.outQueue.dequeueAll();
        if (items.length>0) {
            var operations = items.map(function(item) {
                return item.operation;
            });
            return q($
                .ajax({
                    url:this.endpoint,
                    type:"POST",
                    data:JSON.stringify(operations, function(key, value) {
                        if (key===config.syntax.metaKey) {
                            return _.pick(value, config.syntax.resourceKey, config.syntax.versionKey);
                        }
                        else {
                            return value;
                        }
                    }),
                    dataType:"json",
                    contentType:"application/json"
                }))
                .then(function(data) {
                    data.forEach(function(result, index) {
                        items[index].deferred.resolve(q.all(result.map(function(operation) {
                            return this.queueInbound(operation);
                        }.bind(this))));
                    }.bind(this))
                    return this.flushInbound();
                }.bind(this));
        }
        else {
            return q();
        }
    },
    flushInbound:function(options) {
        var items = this.inQueue.dequeueAll();
        return q.all(items.map(function(item) {
            return store
                .put(item.operation.patch)
                .then(function(entity) {
                    item.deferred.resolve(entity);
                });
        }.bind(this)))
    }
});

var dispatcher = module.exports.dispatcher = Dispatcher.new();

var ResourceMixin = module.exports.ResourceMixin = Object.extend({
    fetchLocal:function(query, options) {
        var fetch = extend(
            true,
            {
                query:query
            }
        );
        fetch[config.syntax.metaKey] = {};
        fetch[config.syntax.metaKey][config.syntax.resourceKey] = this.resourceName;
        return store.get(fetch, options)
    },
    fetchRemote:function(query, options) {
        var fetch = extend(
            true,
            {
                query:query
            },
            _.pick(options, "projection", "start", "end"));
        fetch[config.syntax.metaKey] = {};
        fetch[config.syntax.metaKey][config.syntax.resourceKey] = this.resourceName;
        var operation = {
            fetch:fetch
        }
        return dispatcher.queueOutbound(operation);
    }
})


