require("node-polyfill");

var _ = require("underscore");
var Observe = require("observe-js");
var Queue = require("metapath:///banyan/queue.js");
var Entity = require("metapath:///banyan/entity.js");
var Config = require("metapath:///banyan/config.js");

var graph = {};
var operationsQueue = Queue.new();

function jsonReplacer(key, value) {
    if (key===Config.observerKey) {
        return;
    }
    else {
        return value;
    }
}
var OperationEmitter = Object.extend({
    initialize: function (options) {
        this.entity = options.entity;
        this.buildObservers("");
        return this;
    },
    destroy:function(options) {
        this.destroyObservers("");
    },
    createOperation:function(options) {
        var operation = {};
        operation.delta = _.pick(Config.entity, Config.idKey);
        operation.delta[Config.metaKey] = _.pick(this.entity[Config.metaKey], Config.resourceKey, Config.versionKey);
        return operation;
    },
    /*
    TODO
     There is a corner case in change, remove and array observer as well, because if there are multiple references
     to a single non entity object, and one of those is removed, it triggers a destruction of the observer on the object
     even though th object was reachable from distinct paths.  a possible solution is to record observers on objects/arrays
     by unique paths rooted at the enclosing entity.  so a single object could have multiple observers.  when recording deltas
     on the operation though, this would result in multiple delta recordings potentially.  although they would be idempotent
     when applied, if many array elements referred to the same object indirectly, the number of redundant observers could be
     quite high.
    */
    buildObservers:function(path, options) {
        var target = Entity.getValueAtPath(this.entity, path);
        if (_.isArray(target)) {
            var metadata = Entity.getOrCreateValueAtPath(target, Config.metaKey, {});
            metadata[Config.observerKey] = this.buildArrayObserver(path);
            target.forEach(function(element, index) {
                this.buildObservers(extendedPath+"["+index+"]");
            }.bind(this))
        }
        else if (_.isObject(target)) {
            if (Entity.isEntity(target)&&target!==this.entity) {
                return;
            }
            var metadata = Entity.getOrCreateValueAtPath(target, Config.metaKey, {});
            metadata[Config.observerKey] = this.buildObjectObserver(path);
            for (var key in target) {
                if (key===Config.idKey||key===Config.metaKey) {
                    continue;
                }
                var extendedPath = Entity.joinPath(path, key);
                this.buildObservers(extendedPath);
            }
        }
    },
    destroyObservers:function(root, options) {
        if (!_.isObject(root)) {
            return;
        }
        if (_.isArray(root)) {
            if ((Config.metaKey in root)&&(Config.observerKey in root[Config.metaKey])) {
                root[Config.metaKey][Config.observerKey].close();
            }
            root.forEach(function(element) {
                this.destroyObservers(element);
            }.bind(this))
        }
        else {
            for (var key in root) {
                if ((Config.metaKey===key)&&(Config.observerKey in root[Config.metaKey])) {
                    root[Config.metaKey][Config.observerKey].close();
                }
                else {
                    this.destroyObservers(root[key]);
                }
            }
        }
    },
    buildObjectObserver:function(path, options) {
        var object = Entity.getValueAtPath(this.entity, path);
        var observer = new Observe.ObjectObserver(object);
        observer.open(function(added, removed, changed, getOldValue) {
            var operation = this.createOperation();
            var add = function(value, key) {
                var extendedPath = Entity.joinPath(path, key);
                if (Entity.isEntity(value)) {
                    operation.delta[extendedPath] = Entity.getIdentityProxy(value);
                }
                else {
                    operation.delta[extendedPath] = value;
                    this.buildObservers(extendedPath);
                }
            }.bind(this);
            var change = function(value, key) {
                var extendedPath = Entity.joinPath(path, key);
                var oldValue = getOldValue(key);
                this.destroyObservers(oldValue);
                if (Entity.isEntity(value)) {
                    operation.delta[extendedPath] = Entity.getIdentityProxy(value);
                }
                else {
                    operation.delta[extendedPath] = value;
                    this.buildObservers(extendedPath);
                }
            }.bind(this);
            var remove = function(value, key) {
                var extendedPath = Entity.joinPath(path, key);
                var oldValue = getOldValue(key);
                this.destroyObservers(oldValue);
                operation.delta[extendedPath] = Config.deletionToken;
            }.bind(this);

            _.each(added, add);
            _.each(changed, change);
            _.each(removed, remove);

            console.log(JSON.stringify(operation, jsonReplacer, 4));
            operationsQueue.enqueue(operation);
        }.bind(this));
        return observer;
    },
    buildArrayObserver:function(path, options) {
        var array = Entity.getValueAtPath(this.entity, path);
        var observer = new Observe.ArrayObserver(array);
        observer.open(function(splices) {
            var operation = this.createOperation();
            operation.delta[path] = splices.map(function(splice) {
                var index = splice.index;
                var removed = splice.removed;
                var added = array.slice(index, index+splice.addedCount);
                removed.forEach(function(element) {
                    if (Entity.isEntity(element)) {
                    }
                    else {
                        this.destroyObservers(element);
                    }
                }.bind(this))
                return [
                    index,
                    removed.length,
                    added.map(function(element, offset) {
                        if (Entity.isEntity(element)) {
                            return Entity.getIdentityProxy(element);
                        }
                        else {
                            this.buildObservers(path+"["+(index+offset)+"]");
                            return element;
                        }
                    }.bind(this))
                ]
            }.bind(this))
            console.log(JSON.stringify(operation, jsonReplacer, 4));
            operationsQueue.enqueue(operation);
        }.bind(this));
        return observer;
    }
})

var OperationConsumer = Object.extend({
    initialize: function (options) {
        this.entity = options.entity;
        return this;
    },
    applyDelta:function(delta, options) {
        var guid = Entity.getGuid(delta);
        if (!guid) {
            throw "Cannot apply delta because a guid could not be determined.";
        }
        if (Entity.getGuid(delta)!==Entity.getGuid(this.entity)) {
            throw "Cannot apply delta because delta and entity guids do not match.";
        }
        if (Entity.getVersion(delta)!==Entity.getVersion(this.entity)) {
            throw "Cannot apply delta because delta and entity versions are not compatible.";
        }
        for (var key in delta) {
            if (key===Config.idKey||key===Config.metaKey) {
                continue;
            }
            var path = Observe.Path.get(key);
            var value = delta[key];
            if (_.isArray(value)) {
                value.forEach(function(splice) {
                    var index = splice[0];
                    var removedCount = splice[1];
                    var addedValues = splice[2].map(function(addedValue) {
                        if (Entity.isEntity(addedValue)) {
                            return this.upgradeIdentityProxy(addedValue);
                        }
                        else {
                            return addedValue;
                        }
                    }.bind(this));
                    Entity.getValueAtPath(this.entity, key).splice(index, removedCount, addedValues);
                }.bind(this))
            }
            else {
                if (value===Config.deletionToken) {
                    Entity.setValueAtPath(this.entity, key, undefined);
                }
                else {
                    if (Entity.isEntity(value)) {
                        Entity.setValueAtPath(this.entity, key, this.upgradeIdentityProxy(value));
                    }
                    else {
                        Entity.setValueAtPath(this.entity, key, value);
                    }
                }
            }
        }
    },
    upgradeIdentityProxy:function(identityProxy, options) {
        var guid = Entity.getGuid(identityProxy);
        var trackedEntity = graph[guid];
        if (!trackedEntity) {
            trackedEntity = identityProxy;
            graph[guid] = trackedEntity;
        }
        return trackedEntity;
    },
    destroy:function(options) {
    }
});

var Store = module.exports.Store = Object.extend({
    initialize: function (options) {
        this.emitters = {};
        this.consumers = {};
        return this;
    },
    track:function(entity, options) {
        if (!Entity.isEntity(entity)) {
            throw "Cannot track non-entity objects.";
        }
        var guid = Entity.getGuid(entity);
        if (guid in graph) {
            if (graph[guid]===entity) {
                console.log("Entity with GUID "+guid+" is already being tracked.");
            }
            else {
                throw "Cannot track entity with GUID "+guid+" because it is already being tracked and is not referentially equal to the entity already in the store.";
            }
        }
        graph[guid] = entity;
        this.emitters[guid] = OperationEmitter.new({
            entity:entity
        });
        this.consumers[guid] = OperationConsumer.new({
            entity:entity
        });
    },
    untrack:function(entity, options) {
        if (!Entity.isEntity(entity)) {
            throw "Cannot untrack non-entity objects.";
        }
        var guid = Entity.getGuid(entity);
        if (guid in graph) {
            console.log("Attempted to untrack an entity with GUID "+guid+" that is not being tracked.");
            return;
        }
        this.emitters[guid].destroy();
        delete this.emitters[guid];
        this.consumers[guid].destroy();
        delete this.consumers[guid];
        delete graph[guid];
    }

})