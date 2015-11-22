require("node-polyfill");

var _ = require("underscore");
var q = require("q");
var Observe = require("observe-js");
var ObjectPath = require("object-path");
var traverse = require("traverse");
var extend = require("node.extend");
var config = require("./config.js");

var Resource = module.exports.Resource = Object.extend({
    patch:"patch",
    fetch:"fetch",
    registry:{},
    validationStates:{
        valid:"valid",
        invalid:"invalid"
    },
    validators:Object.extend({}),
    resourceName:undefined,
    entityTemplate:{},
    register:function(resource, options) {
        if (_.isArray(resource)) {
            resource.forEach(function(resourceItem) {
                this.register(resourceItem, options);
            }.bind(this));
            return;
        }
        if (resource.resourceName in Resource.registry) {
            throw "Cannot register a resource under the name "+resource.resourceName+" because this name already exists in the resource registry."
        }
        Resource.registry[resource.resourceName] = resource;
    },
    lookup:function(name) {
        return Resource.registry[name];
    },
    forEntity:function (entity) {
        if (!entity) {
            return undefined;
        }
        else {
            return this.lookup(entity[config.syntax.metaKey]._r);
        }
    },
    validate:function(path, value) {
        var validator = ObjectPath.get(this.validators, path);
        var validation;
        if (!validator) {
            validation = {
                state:this.validationStates.valid
            }
        }
        else {
            validation = validator(value);
        }
        return validation;
    },
    buildGuid:function() {
        var resourceName;
        var id;
        if (arguments.length===1) {
            resourceName = this.resourceName;
            id = arguments[0];
        }
        else {
            resourceName = arguments[0];
            id = arguments[1];
        }
        return resourceName+"/"+id;
    },
    buildEntityProxy:function() {
        var resourceName;
        var id;
        if (arguments.length===1) {
            resourceName = this.resourceName;
            id = arguments[0];
        }
        else {
            resourceName = arguments[0];
            id = arguments[1];
        }
        var entityProxy = {};
        entityProxy[config.syntax.idKey] = id;
        entityProxy[config.syntax.metaKey] = {};
        entityProxy[config.syntax.metaKey]._r = resourceName;
        return entityProxy;
    }
})

var Entity = module.exports.Entity = Object.extend({
    PATCH_MODE_NONE:0,
    PATCH_MODE_MERGE:1,
    PATCH_MODE_REPLACE:2,
    getMetaData:function(entity, path) {
        if (!path) {
            return {};
        }
        else if (_.isObject(path)) {
            return path[config.syntax.metaKey]||{};
        }
        else if (_.isString(path)) {
            var metadataPath = Path.buildMetadataPath(path);
            return ObjectPath.get(entity, metadataPath)||{};
        }
    },
    isEntity:function(object) {
        return (_.isObject(object))
            && (config.syntax.idKey in object)
            && (config.syntax.metaKey in object)
            && (object[config.syntax.metaKey]._r);
    },
    getGuid:function(entity) {
        return Resource.buildGuid(entity[config.syntax.metaKey]._r, entity[config.syntax.idKey]);
    },
    getVersion:function(entity) {
        return entity[config.syntax.versionKey];
    },
    getId:function(entity) {
        return entity[config.syntax.idKey];
    },
    getProxy:function (entity) {
        var entityProxy = {};
        if (this.isEntity(entity)) {
            entityProxy[config.syntax.idKey] = entity[config.syntax.idKey];
            entityProxy[config.syntax.versionKey] = entity[config.syntax.versionKey];
            entityProxy[config.syntax.metaKey] = _.pick(entity[config.syntax.metaKey], "_r")
            return entityProxy;
        }
        else {
            return undefined;
        }
    },
    getValueAtPath:function(entity, path) {
        var objectPath = Path.normalizePath(path);
        return ObjectPath.get(entity, objectPath);
    },
    getOrCreateValueAtPath:function(entity, path, defaultValue) {
        var objectPath = Path.normalizePath(path);
        var value = ObjectPath.get(entity, objectPath);
        if (_.isUndefined(value)) {
            value = defaultValue;
            ObjectPath.set(entity, objectPath, value)
        }
        return value;
    },
    setValueAtPath:function(entity, path, value) {
        if (""===path) {
            return;
        }
        else {
            var objectPath = Path.normalizePath(path);
            ObjectPath.set(entity, objectPath, value);
        }
    },
    strip:function(root, options) {
        var thiz = this;
        traverse(root).forEach(function(value) {
            if (this.isRoot) {
                return;
            }
            else if (this.key===config.syntax.idKey||this.key==="_r") {
                return;
            }
            else if (this.key==="._observer") {
                this.remove();
            }
            else if (thiz.isEntity(value)||!(_.isObject(value))) {
                this.remove();
            }
        })
    },
    getPatchMode:function(entity, patch) {
        if (!patch[config.syntax.versionKey]) {
            return this.PATCH_MODE_NONE;
        }
        if (!entity[config.syntax.versionKey]) {
            return this.PATCH_MODE_REPLACE;
        }
        if (entity[config.syntax.versionKey]===patch[config.syntax.versionKey]) {
            return this.PATCH_MODE_MERGE;
        }
    },
    applyPatch:function(patch, target, options) {
        for (var key in patch) {
            if (key===config.syntax.idKey ||
                key===config.syntax.metaKey||
                key===config.syntax.versionKey) {
                continue;
            }
            var value = patch[key];
            if (_.isArray(value)) {
                value.forEach(function(splice) {
                    var index = splice[0];
                    var removedCount = splice[1];
                    var addedValues = splice[2]
                    this.getValueAtPath(target, key).splice(index, removedCount, addedValues);
                }.bind(this))
            }
            else {
                if (value===config.syntax.deletionToken) {
                    this.setValueAtPath(target, key, undefined);
                }
                else if (_.isObject(value)) {
                    if (this.isEntity(value)) {
                        this.setValueAtPath(target, key, value);
                    }
                    else {
                        extend(true, this.getOrCreateValueAtPath(target, key, {}), value);
                    }
                }
                else {
                    this.setValueAtPath(target, key, value);
                }
            }
        }

    }
})

var Path = module.exports.Path = Object.extend({
    arrayPathPattern:/[\[\]]]/g,
    objectPathDelimiterPattern:/\./g,
    backPathPattern:/[^.]+\.\.\.\./g,
    normalizePath:function(observePath) {
        var objectPath = observePath.replace(this.arrayPathPattern, ".");
        var length = 0;
        while (length!==objectPath.length) {
            length = objectPath.length;
            objectPath = objectPath.replace(this.backPathPattern, "");
        }
        return objectPath;
    },
    buildPath:function(parts) {
        return this.normalizePath(parts.join("."));
    },
    buildMetadataPath:function(path) {
        var normalizedPath = this.normalizePath(path);
        var parts = normalizedPath.split(this.objectPathDelimiterPattern);
        var metadataPath = this.buildPath([
            normalizedPath,
            "..",
            config.syntax.metaKey,
            _.last(parts)
        ]);
        return metadataPath;
    },
    joinPath:function(root, suffix) {
        if (""===root) {
            return suffix;
        }
        else {
            return root+"."+suffix;
        }
    }
})

