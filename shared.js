require("node-polyfill");

var _ = require("underscore");
var q = require("q");
var Observe = require("observe-js");
var ObjectPath = require("object-path");
var traverse = require("traverse");
var extend = require("node.extend");
var config = require("./config.js");

var Resource = module.exports.Resource = Object.extend({
    registry:{},
    fetchKeys: {
        id: "id",
        search:"search",
        autocomplete:"autocomplete"
    },
    patchKeys:{
        create:"create",
        update:"update",
        delete:"delete"
    },
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
            return this.lookup(entity[config.syntax.metaKey][config.syntax.resourceKey]);
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
        entityProxy[config.syntax.metaKey][config.syntax.resourceKey] = resourceName;
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
            && (config.syntax.resourceKey in object[config.syntax.metaKey]);
    },
    getGuid:function(entity) {
        return Resource.buildGuid(entity[config.syntax.metaKey][config.syntax.resourceKey], entity[config.syntax.idKey]);
    },
    getVersion:function(entity) {
        return entity[config.syntax.metaKey][config.syntax.versionKey];
    },
    getId:function(entity) {
        return entity[config.syntax.idKey];
    },
    getProxy:function (entity) {
        var entityProxy = {};
        if (this.isEntity(entity)) {
            entityProxy[config.syntax.idKey] = entity[config.syntax.idKey];
            entityProxy[config.syntax.metaKey] = _.pick(entity[config.syntax.metaKey], config.syntax.versionKey, config.syntax.resourceKey)
            return entityProxy;
        }
        else {
            return undefined;
        }
    },
    // TODO why is this using Observe vs ObjectPath?
    getValueAtPath:function(entity, path) {
        if (""===path) {
            return entity
        }
        else {
            return Observe.Path.get(path).getValueFrom(entity);
        }
    },
    getOrCreateValueAtPath:function(entity, path, defaultValue) {
        if (""===path) {
            return entity
        }
        else {
            var objectPath = Path.normalizePath(path);
            var value = ObjectPath.get(entity, objectPath);
            if (_.isUndefined(value)) {
                value = defaultValue;
                ObjectPath.set(entity, objectPath, value)
            }
            return value;
        }
    },
    setValueAtPath:function(entity, path, value) {
        if (""===path) {
            return;
        }
        else {
            ObjectPath.set(entity, Path.normalizePath(path), value);
        }
    },
    strip:function(root, options) {
        var thiz = this;
        traverse(root).forEach(function(value) {
            if (this.isRoot) {
                return;
            }
            else if (this.key===config.syntax.idKey||this.key===config.syntax.resourceKey) {
                return;
            }
            else if (this.key===config.syntax.observerKey) {
                this.remove();
            }
            else if (thiz.isEntity(value)||!(_.isObject(value))) {
                this.remove();
            }
        })
    },
    getPatchMode:function(entity, patch) {
        if (!patch[config.syntax.metaKey]||!patch[config.syntax.metaKey][config.syntax.versionKey]) {
            return this.PATCH_MODE_NONE;
        }
        if (!entity[config.syntax.metaKey]||!entity[config.syntax.metaKey][config.syntax.versionKey]) {
            return this.PATCH_MODE_REPLACE;
        }
        if (entity[config.syntax.metaKey][config.syntax.versionKey]===patch[config.syntax.metaKey][config.syntax.versionKey]) {
            return this.PATCH_MODE_MERGE;
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

