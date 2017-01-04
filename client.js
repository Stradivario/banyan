if (!global._banyan) {
    global._banyan = {};
}

require("node-polyfill");

var log = require("loglevel");
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

// TODO _ignore processing should be deprecated, it was never a clean solution
var Store = Object.extend({
    initialize:function(options) {
        this.graph = {};
        this.pendingPatches = {};
        return this;
    },

    upgrade:function(patch, options) {
        var thiz = this;
        traverse(patch).forEach(function() {
            if (this.notRoot&&shared.Entity.isEntity(this.node)) {
                var guid = shared.Entity.getGuid(this.node);
                var trackedEntity = thiz.graph[guid];
                if (!trackedEntity) {
                    trackedEntity = thiz.put(this.node);
                }
                this.update(trackedEntity, true);
            }
        })
    },
    patch:function(patch, options) {
        var snippedPatches = shared.Entity.snip(patch);
        var snippedEntities = snippedPatches
            .filter(function(snippedPatch) {
                return !shared.Entity.isProxy(snippedPatch);
            }.bind(this))
            .map(function(snippedPatch) {
                return this.put(snippedPatch, options);
            }.bind(this));
        return snippedEntities[0];
    },
    put:function(patch, options) {
        var thiz = this;
        var guid = shared.Entity.getGuid(patch);
        if (!guid) {
            throw "Cannot put patch in store because a guid could not be determined.";
        }

        if (shared.Entity.isVersionPatch(patch)) {
            var entity = this.graph[guid];
            if (entity) {
                shared.Entity.applyPatch(entity, patch);
            }
            else {
                throw "Cannot apply a version patch if entity does not already exist in store.";
            }
        }
        else {
            var entity = this.graph[guid];

            if (entity) {
                var versionCheck = shared.Entity.checkVersion(entity, patch);
                if (versionCheck === shared.Entity.VERSION_AHEAD) {
                    this.closeObservers(entity);
                    shared.Entity.strip(entity);
                    var resource = shared.Resource.forEntity(entity);
                    if (resource) {
                        extend(true, entity, resource.entityTemplate);
                    }
                }

                if (versionCheck !== shared.Entity.VERSION_BEHIND) {
                    shared.Entity.applyPatch(entity, patch);
                    this.upgrade(entity);
                }

                if (versionCheck === shared.Entity.VERSION_AHEAD) {
                    this.buildObservers(entity, "");
                }
            }
            else {
                entity = shared.Entity.getProxy(patch);
                var resource = shared.Resource.forEntity(entity);
                if (resource) {
                    extend(true, entity, resource.entityTemplate, patch);
                }
                else {
                    extend(true, entity, patch);
                }
                this.upgrade(entity);
                this.track(entity);
            }
        }
        this.discardObservations(entity);
        return entity;
    },
    get:function(fetch, options) {
        var guid = shared.Resource.buildGuid(fetch[config.syntax.idKey], fetch[config.syntax.metaKey]._r);
        if (guid in this.graph) {
            return this.graph[guid]
        }
        else {
            return undefined;
        }
    },
    discardObservations:function(root, options) {
        traverse(root).forEach(function(value) {
            if (this.key==="_observer") {
                try {
                    value.discardChanges();
                    this.block();
                }
                catch (e) {
                    log.error(e);
                }
            }
            else if (this.notRoot&&shared.Entity.isEntity(value)) {
                this.block();
            }
        })
    },
    closeObservers:function(root, options) {
        traverse(root).forEach(function(value) {
            if (this.notRoot&&shared.Entity.isEntity(this.node)) {
                this.update(this.node, true);
            }
            if (this.key==="_observer") {
                value.close();
            }
        })
    },
    buildObservers:function(entity, path, options) {
        var target = shared.Entity.getValueAtPath(entity, path);
        if (_.isArray(target)) {
            var metadata = shared.Entity.getOrCreateValueAtPath(target, config.syntax.metaKey, {});
            metadata._observer = this.buildArrayObserver(entity, path);
            target.forEach(function(element, index) {
                this.buildObservers(entity, extendedPath+"["+index+"]");
            }.bind(this))
        }
        else if (_.isObject(target)) {
            if (shared.Entity.isEntity(target)&&target!==entity) {
                return;
            }
            var metadata = shared.Entity.getOrCreateValueAtPath(target, config.syntax.metaKey, {});
            metadata._observer = this.buildObjectObserver(entity, path);
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
            var patch = this.pendingPatches[entity[config.syntax.idKey]];
            if (!patch) {
                patch = {};
                patch[config.syntax.idKey] = entity[config.syntax.idKey];
                patch[config.syntax.versionKey] = entity[config.syntax.versionKey];
                this.pendingPatches[entity[config.syntax.idKey]] = patch;
            }
            var valid = true;
            var add = function(value, key) {
                if (key===config.syntax.metaKey) {
                    return;
                }
                var extendedPath = shared.Path.joinPath(path, key);
                var metadata = shared.Entity.getMetaData(entity, extendedPath);
                var validation = resource.validate(extendedPath, value, metadata);
                if (!metadata._ignore&&validation.state===shared.Resource.validationStates.valid) {
                    if (shared.Entity.isEntity(value)) {
                        patch[extendedPath] = shared.Entity.getProxy(value);
                    }
                    else {
                        patch[extendedPath] = value;
                        this.buildObservers(entity, extendedPath);
                    }
                }
                else {
                    valid = false;
                }
                ObjectPath.set(entity, shared.Path.joinPath(shared.Path.buildMetadataPath(extendedPath), config.syntax.validationPath), validation);
            }.bind(this);
            var change = function(value, key) {
                if (key===config.syntax.metaKey) {
                    return;
                }
                var extendedPath = shared.Path.joinPath(path, key);
                var oldValue = getOldValue(key);
                this.closeObservers(oldValue);
                var metadata = shared.Entity.getMetaData(entity, extendedPath);
                var validation = resource.validate(extendedPath, value, metadata);
                if (!metadata._ignore&&validation.state===shared.Resource.validationStates.valid) {
                    if (shared.Entity.isEntity(value)) {
                        patch[extendedPath] = shared.Entity.getProxy(value);
                    }
                    else {
                        patch[extendedPath] = value;
                        this.buildObservers(entity, extendedPath);
                    }
                }
                else {
                    valid = false;
                }
                ObjectPath.set(entity, shared.Path.joinPath(shared.Path.buildMetadataPath(extendedPath), config.syntax.validationPath), validation);
            }.bind(this);
            var remove = function(value, key) {
                if (key===config.syntax.metaKey) {
                    return;
                }
                var extendedPath = shared.Path.joinPath(path, key);
                var metadata = shared.Entity.getMetaData(entity, extendedPath);
                var validation = resource.validate(extendedPath, undefined, metadata);
                if (!metadata._ignore&&validation.state===shared.Resource.validationStates.valid) {
                    var oldValue = getOldValue(key);
                    this.closeObservers(oldValue);
                    patch[extendedPath] = config.syntax.deletionToken;
                }
                else {
                    valid = false;
                }
                ObjectPath.set(entity, shared.Path.joinPath(shared.Path.buildMetadataPath(extendedPath), config.syntax.validationPath), validation);
            }.bind(this);

            _.each(added, add);
            _.each(changed, change);
            _.each(removed, remove);

            if (valid&& !_.isEmpty(patch)) {
                _.defer(function() {
                    var pendingPatch = this.pendingPatches[entity[config.syntax.idKey]];
                    if (pendingPatch) {
                        resource.patch({
                            data:pendingPatch
                        });
                        delete this.pendingPatches[entity[config.syntax.idKey]]
                    }
                }.bind(this))
            }
        }.bind(this));
        return observer;
    },
    buildArrayObserver:function(entity, path, options) {
        var array = shared.Entity.getValueAtPath(entity, path);
        var observer = new Observe.ArrayObserver(array);
        var resource = shared.Resource.forEntity(entity);
        observer.open(function(splices) {
            var patch = this.pendingPatches[entity[config.syntax.idKey]];
            if (!patch) {
                patch = {};
                patch[config.syntax.idKey] = entity[config.syntax.idKey];
                patch[config.syntax.versionKey] = entity[config.syntax.versionKey];
                this.pendingPatches[entity[config.syntax.idKey]] = patch;
            }
            patch[path] = splices.map(function(splice) {
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
            _.defer(function() {
                var pendingPatch = this.pendingPatches[entity[config.syntax.idKey]];
                if (pendingPatch) {
                    resource.patch({
                        data:pendingPatch
                    })
                    delete this.pendingPatches[entity[config.syntax.idKey]]
                }
            }.bind(this))
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
                log.info("Entity with GUID "+guid+" is already being tracked.");
            }
            else {
                var message = "Cannot track entity with GUID "+guid+" because it is already being tracked and is not referentially equal to the entity already in the store.";
                log.error(message)
                throw {
                    message:message,
                    guid:guid
                };
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
            log.warn("Attempted to untrack an entity with GUID "+guid+" that is not being tracked.");
            return;
        }
        this.closeObservers(entity);
        delete this.graph[guid];
    }
})

var store = module.exports.store = _banyan.store = _banyan.store?_banyan.store:Store.new();

var Dispatcher = Object.extend({
    initialize:function(options) {
        this.inQueue = Queue.new();
        this.outQueue = Queue.new();
        this.pendingOutboundFlush = false;
        this.activeOutboundFlush = false;
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
        if (!options.wait) {
            this.flushOutbound();
        }
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
        var count = this.outQueue.getLength();
        var items = this.outQueue.peekAll();
        if (this.activeOutboundFlush) {
            this.pendingOutboundFlush = true;
        }
        else if (items.length>0) {
            this.activeOutboundFlush = true;
            this.pendingOutboundFlush = false;
            var operations = items.map(function(item) {
                return item.operation;
            });
            return q($
                .ajax({
                    timeout:30000,
                    url:this.endpoint,
                    type:"POST",
                    data:JSON.stringify(operations, function(key, value) {
                        if (key===config.syntax.metaKey) {
                            return _.pick(value, "_r", "_op", "_query");
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
                        if (_.isArray(result)) {
                            items[index].deferred.resolve(q.all(result.map(function(operation) {
                                return this.queueInbound(operation);
                            }.bind(this))));
                        }
                        else {
                            items[index].deferred.resolve(this.queueInbound(result));
                        }
                    }.bind(this));
                    this.outQueue.dequeueSome(count);
                    return this
                        .flushInbound()
                        .then(function(result) {
                            this.activeOutboundFlush = false;
                            if (this.pendingOutboundFlush) {
                                this.flushOutbound();
                            }
                            return result;
                        }.bind(this));
                }.bind(this))
                .fail(function(err) {
                    this.activeOutboundFlush = false;
                    if (this.pendingOutboundFlush) {
                        this.flushOutbound();
                    }
                }.bind(this))
        }
        else {
            return q();
        }
    },
    flushInbound:function(options) {
        var items = this.inQueue.dequeueAll();
        return q
            .all(items.map(function(item) {
                return q(store.patch(item.operation))
                    .then(function(entity) {
                        item.deferred.resolve(entity);
                        return entity;
                    });
            }.bind(this)))
            .then(function(results) {
                Platform.performMicrotaskCheckpoint();
                return results;
            })
    }
});

var dispatcher = module.exports.dispatcher = _banyan.dispatcher = _banyan.dispatcher?_banyan.dispatcher:Dispatcher.new();

var ResourceMixin = module.exports.ResourceMixin = Object.extend({
    register:function(resource, options) {
        extend(resource, this.buildFetchers(resource));
        shared.Resource.register.call(this, resource, options);
    },
    refreshAuth:function() {
        return q();
    },
    send:function(options) {
        options = options||{};
        var operation = this.buildOperation(this.getOperationKey(options.operation), options.data||_.omit(options, "operation"));
        return this
            .refreshAuth()
            .then(function() {
                return dispatcher.queueOutbound(operation, options);
            })
    },
    getPrimaryEntities:function(results) {
        if (_.isArray(results)) {
            return results.filter(function(result) {
                return this.resourceName===result[config.syntax.metaKey]._r;
            }.bind(this))
        }
        else {
            return results;
        }
    },
    getPrimaryEntity:function(results) {
        var primaryResults = this.getPrimaryEntities(results);
        if (_.isArray(primaryResults)) {
            if (primaryResults.length>0) {
                return primaryResults[0];
            }
            else {
                return undefined;
            }
        }
        else {
            return primaryResults;
        }
    },
    patch:function(options) {
        options = options || {};
        options.operation = shared.Resource.operations.patch;
        return this.send(options);
    },
    create:function(data) {
        return this.patch({
            data:data
        });
    },
    fetchOne:function(options) {
        return this
            .send(options)
            .then(this.getPrimaryEntity.bind(this))
    },
    fetchSome:function(options) {
        return this
            .send(options)
            .then(this.getPrimaryEntities.bind(this))
    },
    buildFetchers:function(resource) {
        return _.mapObject(_.omit(resource.operations, "patch"), function(spec, operation) {
            var args = spec.args||[];
            return function() {
                var options = arguments[args.length]||{};
                options.operation = operation;
                options.query = options.query||{};
                for (var i=0; i<args.length; i++) {
                    options.query[args[i]] = arguments[i];
                }
                return spec.unique?resource.fetchOne(options):resource.fetchSome(options);
            }
        })
    }
})
