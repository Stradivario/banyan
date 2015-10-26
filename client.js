require("node-polyfill");

var _ = require("underscore");
var $ = require("jquery");
var q = require("q");
var Observe = require("observe-js");
var Queue = require("./queue.js");
var Entity = require("./entity.js");
var Resource = require("./resource.js");
var Config = require("./config.js");
var Traverse = require("traverse");
var extend = require("node.extend");

var Store = Object.extend({
    initialize:function(options) {
        this.graph = {};
        return this;
    },
    upgradeEntityProxy:function(entityProxy, options) {
        var guid = Entity.getGuid(entityProxy);
        var trackedEntity = this.graph[guid];
        if (!trackedEntity) {
            trackedEntity = entityProxy;
            this.graph[guid] = trackedEntity;
        }
        return trackedEntity;
    },
    discardObservations:function(root, options) {
        Traverse(root).forEach(function(value) {
            if (this.key===Config.observerKey) {
                value.discardChanges();
            }
        })
    },
    closeObservers:function(root, options) {
        Traverse(root).forEach(function(value) {
            if (this.key===Config.observerKey) {
                value.close();
            }
        })
    },
    patchRemote:function(operation, options) {
        return dispatcher.queueOutbound(operation);
    },
    patchLocal:function(patch, options) {
        var guid = Entity.getGuid(patch);
        if (!guid) {
            throw "Cannot apply patch because a guid could not be determined.";
        }
        var entity = this.graph[guid];
        var patchMode;
        if (!entity) {
            entity = Entity.getEntityProxy(patch);
            patchMode = Entity.PATCH_MODE_REPLACE;
            this.graph[guid] = entity;
        }
        else {
            patchMode = Entity.getPatchMode(entity, patch);
        }
        if (patchMode===Entity.PATCH_MODE_NONE) {
            throw "Cannot apply patch because patch and entity versions are not compatible.";
        }
        else if (patchMode===Entity.PATCH_MODE_REPLACE) {
            var resource = Entity.getResource(entity);
            this.closeObservers(entity);
            Entity.strip(entity);
            if (resource) {
                extend(true, entity, resource.template);
            }
            this.buildObservers(entity, "");
        }
        for (var key in patch) {
            if (key===Config.idKey||key===Config.metaKey) {
                continue;
            }
            var path = Observe.Path.get(key);
            var value = patch[key];
            if (_.isArray(value)) {
                value.forEach(function(splice) {
                    var index = splice[0];
                    var removedCount = splice[1];
                    var addedValues = splice[2].map(function(addedValue) {
                        if (Entity.isEntity(addedValue)) {
                            return this.upgradeEntityProxy(addedValue);
                        }
                        else {
                            return addedValue;
                        }
                    }.bind(this));
                    Entity.getValueAtPath(entity, key).splice(index, removedCount, addedValues);
                }.bind(this))
            }
            else {
                if (value===Config.deletionToken) {
                    Entity.setValueAtPath(entity, key, undefined);
                }
                else if (_.isObject(value)) {
                    if (Entity.isEntity(value)) {
                        Entity.setValueAtPath(entity, key, this.upgradeEntityProxy(value));
                    }
                    else {
                        extend(true, Entity.getOrCreateValueAtPath(entity, key, {}), value);
                    }
                }
                else {
                    Entity.setValueAtPath(entity, key, value);
                }
            }
        }
        this.discardObservations(entity);
        Platform.performMicrotaskCheckpoint();
        return q(entity);
    },
    fetchRemote:function(fetch, options) {
        return dispatcher.queueOutbound(Entity.createFetchOperation(fetch));
    },
    fetchLocal:function(fetch, options) {
        if (!fetch[Config.idKey]) {
            return this.fetchRemote(fetch);
        }
        var guid = Entity.getGuid(fetch);
        var entity;
        if (guid in this.graph) {
            entity = this.graph[guid]
            return q(entity);
        }
        else {
            this.fetchRemote(fetch);
            return this.patchLocal(fetch);
        }
    },
    buildObservers:function(entity, path, options) {
        var target = Entity.getValueAtPath(entity, path);
        if (_.isArray(target)) {
            var metadata = Entity.getOrCreateValueAtPath(target, Config.metaKey, {});
            metadata[Config.observerKey] = this.buildArrayObserver(entity, path);
            target.forEach(function(element, index) {
                this.buildObservers(entity, extendedPath+"["+index+"]");
            }.bind(this))
        }
        else if (_.isObject(target)) {
            if (Entity.isEntity(target)&&target!==entity) {
                return;
            }
            var metadata = Entity.getOrCreateValueAtPath(target, Config.metaKey, {});
            metadata[Config.observerKey] = this.buildObjectObserver(entity, path);
            for (var key in target) {
                if (key===Config.idKey||key===Config.metaKey) {
                    continue;
                }
                var extendedPath = Entity.joinPath(path, key);
                this.buildObservers(entity, extendedPath);
            }
        }
    },
    buildObjectObserver:function(entity, path, options) {
        var object = Entity.getValueAtPath(entity, path);
        var observer = new Observe.ObjectObserver(object);
        observer.open(function(added, removed, changed, getOldValue) {
            var patchData = {};
            var add = function(value, key) {
                var extendedPath = Entity.joinPath(path, key);
                if (Entity.isEntity(value)) {
                    patchData[extendedPath] = Entity.getEntityProxy(value);
                }
                else {
                    patchData[extendedPath] = value;
                    this.buildObservers(entity, extendedPath);
                }
            }.bind(this);
            var change = function(value, key) {
                var extendedPath = Entity.joinPath(path, key);
                var oldValue = getOldValue(key);
                this.closeObservers(oldValue);
                if (Entity.isEntity(value)) {
                    patchData[extendedPath] = Entity.getEntityProxy(value);
                }
                else {
                    patchData[extendedPath] = value;
                    this.buildObservers(entity, extendedPath);
                }
            }.bind(this);
            var remove = function(value, key) {
                var extendedPath = Entity.joinPath(path, key);
                var oldValue = getOldValue(key);
                this.closeObservers(oldValue);
                patchData[extendedPath] = Config.deletionToken;
            }.bind(this);

            _.each(added, add);
            _.each(changed, change);
            _.each(removed, remove);

            var patch = Entity.createPatch(entity, patchData);
            dispatcher.queueOutbound(Entity.createPatchOperation(patch));

        }.bind(this));
        return observer;
    },
    buildArrayObserver:function(entity, path, options) {
        var array = Entity.getValueAtPath(entity, path);
        var observer = new Observe.ArrayObserver(array);
        observer.open(function(splices) {
            var patchData = {};
            patchData[path] = splices.map(function(splice) {
                var index = splice.index;
                var removed = splice.removed;
                var added = array.slice(index, index+splice.addedCount);
                removed.forEach(function(element) {
                    if (Entity.isEntity(element)) {
                    }
                    else {
                        this.closeObservers(element);
                    }
                }.bind(this))
                return [
                    index,
                    removed.length,
                    added.map(function(element, offset) {
                        if (Entity.isEntity(element)) {
                            return Entity.getEntityProxy(element);
                        }
                        else {
                            this.buildObservers(entity, path+"["+(index+offset)+"]");
                            return element;
                        }
                    }.bind(this))
                ]
            }.bind(this))

            var patch = Entity.createPatch(entity, patchData);
            dispatcher.queueOutbound(Entity.createPatchOperation(patch));

        }.bind(this));
        return observer;
    },
    track:function(entity, options) {
        if (!Entity.isEntity(entity)) {
            throw "Cannot track non-entity objects.";
        }
        var guid = Entity.getGuid(entity);
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
        if (!Entity.isEntity(entity)) {
            throw "Cannot untrack non-entity objects.";
        }
        var guid = Entity.getGuid(entity);
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
        dispatcher.flushOutbound();
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
                    data:JSON.stringify(operations, Entity.operationReplacer),
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
                .patchLocal(item.operation.patch)
                .then(function(entity) {
                    item.deferred.resolve(entity);
                });
        }.bind(this)))
    }
});

var dispatcher = module.exports.dispatcher = Dispatcher.new();