require("node-polyfill");

var _ = require("underscore");
var $ = require("jquery");
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
    buildObjectObserver:function(entity, path, options) {
        var object = Entity.getValueAtPath(entity, path);
        var observer = new Observe.ObjectObserver(object);
        observer.open(function(added, removed, changed, getOldValue) {
            var operation = Entity.createPatchOperation(entity);
            var add = function(value, key) {
                var extendedPath = Entity.joinPath(path, key);
                if (Entity.isEntity(value)) {
                    operation.patch[extendedPath] = Entity.getEntityProxy(value);
                }
                else {
                    operation.patch[extendedPath] = value;
                    this.buildObservers(entity, extendedPath);
                }
            }.bind(this);
            var change = function(value, key) {
                var extendedPath = Entity.joinPath(path, key);
                var oldValue = getOldValue(key);
                this.closeObservers(oldValue);
                if (Entity.isEntity(value)) {
                    operation.patch[extendedPath] = Entity.getEntityProxy(value);
                }
                else {
                    operation.patch[extendedPath] = value;
                    this.buildObservers(entity, extendedPath);
                }
            }.bind(this);
            var remove = function(value, key) {
                var extendedPath = Entity.joinPath(path, key);
                var oldValue = getOldValue(key);
                this.closeObservers(oldValue);
                operation.patch[extendedPath] = Config.deletionToken;
            }.bind(this);

            _.each(added, add);
            _.each(changed, change);
            _.each(removed, remove);

            dispatcher.queueOutbound(operation);
        }.bind(this));
        return observer;
    },
    buildArrayObserver:function(entity, path, options) {
        var array = Entity.getValueAtPath(entity, path);
        var observer = new Observe.ArrayObserver(array);
        observer.open(function(splices) {
            var operation = Entity.createPatchOperation(entity);
            operation.patch[path] = splices.map(function(splice) {
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
            dispatcher.queueOutbound(operation);
        }.bind(this));
        return observer;
    },
    strip:function(root, options) {
        Traverse(root).forEach(function(value) {
            if (this.isRoot) {
                return;
            }
            else if (this.key===Config.observerKey) {
                this.remove();
            }
            else if (Entity.isEntity(value)||!(_.isObject(value))) {
                this.remove();
            }
        })
    },
    applyPatch:function(patch, options) {
        var guid = Entity.getGuid(patch);
        if (!guid) {
            throw "Cannot apply patch because a guid could not be determined.";
        }
        var entity = this.graph[guid];
        if (!entity) {
            throw "Cannot apply patch because a baseline entity was not found.";
        }
        var patchMode = Entity.getPatchMode(entity, patch);
        if (patchMode===Entity.PATCH_MODE_NONE) {
            throw "Cannot apply patch because patch and entity versions are not compatible.";
        }
        else if (patchMode===Entity.PATCH_MODE_REPLACE) {
            this.strip(entity);
            var resource = Resource.lookup(Entity.getResource(entity));
            if (resource) {
                extend(true, entity, resource.template);
            }
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
    fetch:function(resourceName, id, options) {
        var guid = Entity.createGuid(resourceName, id);
        var entity;
        if (guid in this.graph) {
            entity = this.graph[guid]
        }
        else {
            var entity = Entity.buildEntityProxy(resourceName, id);
            var resource = Resource.lookup(resourceName);
            if (resource) {
                extend(true, entity, resource.template);
            }
            this.track(entity);
        }
        if (options.force) {
            var operation = Entity.createFetchOperation(resourceName);
            operation.fetch.query = {
                id:id
            }
            dispatcher.queueOutbound(operation);
            dispatcher.flushOutbound();
        }
        return entity;
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
    },
    consumeOperation:function(operation, options) {
        if (operation.patch) {
            this.applyPatch(operation.patch);
        }
        else if (operation.entity) {

        }
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
        this.outQueue.enqueue(operation);
    },
    queueInbound:function(operation, options) {
        this.inQueue.enqueue(operation);
    },
    flushOutbound:function(options) {
        var operations = this.outQueue.dequeueAll();
        $
            .ajax({
                url:this.endpoint,
                type:"POST",
                data:JSON.stringify(operations, Entity.operationReplacer),
                dataType:"json",
                contentType:"application/json"
            })
            .done(function(data) {
                data.forEach(function(operation, index) {
                    this.queueInbound(operation);
                }.bind(this))
                this.flushInbound();
            }.bind(this))
    },
    flushInbound:function(options) {
        var operations = this.inQueue.dequeueAll();
        operations.forEach(function(operation) {
            store.consumeOperation(operation);
        }.bind(this))
    }
});

var dispatcher = module.exports.dispatcher = Dispatcher.new();