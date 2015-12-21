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
        var newEntityTemplate = extend(true, {}, resource.entityTemplate);
        traverse(newEntityTemplate).forEach(function(value) {
            if (this.key===config.syntax.metaKey) {
                this.remove();
            }
            else {
                return;
            }
        });
        newEntityTemplate[config.syntax.metaKey] = {};
        newEntityTemplate[config.syntax.metaKey]._r = resource.resourceName;
        resource.newEntityTemplate = newEntityTemplate;

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
    validate:function(path, value, metadata) {
        var validator = ObjectPath.get(this.validators, path);
        var validation;
        if (!validator) {
            validation = {
                state:this.validationStates.valid
            }
        }
        else {
            validation = validator(value, metadata);
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
    },
    buildNewEntity:function() {
        return extend(true, {}, this.newEntityTemplate);
    }
})

var Entity = module.exports.Entity = Object.extend({
    VERSION_BEHIND:0,
    VERSION_AHEAD:1,
    VERSION_COMPATIBLE:2,
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
    getVersionPatch:function(entity) {
        var versionPatch = _.pick(entity, config.syntax.metaKey, config.syntax.versionKey, config.syntax.idKey);
        versionPatch[config.syntax.metaKey][config.syntax.versionKey] = entity[config.syntax.versionKey];
        return versionPatch;
    },
    isVersionPatch:function(operation) {
        return (config.syntax.versionKey in operation[config.syntax.metaKey]);
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
    checkVersion:function(entity, patch) {
        if (!entity[config.syntax.versionKey]&&patch[config.syntax.versionKey]) {
            return this.VERSION_AHEAD;
        }
        if (!patch[config.syntax.versionKey]&&entity[config.syntax.versionKey]) {
            return this.VERSION_BEHIND;
        }
        if (entity[config.syntax.versionKey]>patch[config.syntax.versionKey]) {
            return this.VERSION_BEHIND;
        }
        else if (entity[config.syntax.versionKey]<patch[config.syntax.versionKey]) {
            return this.VERSION_AHEAD;
        }
        else {
            return this.VERSION_COMPATIBLE;
        }
    },
    applyPatch:function(entity, patch, options) {
        var thiz = this;
        traverse(patch).forEach(function(value) {
            var path = Path.buildPath(this.path);
            if (this.isRoot) {
                return;
            }
            else if (path === config.syntax.idKey) {
                return;
            }
            else if (_.isArray(value)) {
                value.forEach(function (splice) {
                    var index = splice[0];
                    var removedCount = splice[1];
                    var addedValues = splice[2];
                    [].splice.apply(thiz.getValueAtPath(entity, path), [index, removedCount].concat(addedValues));
                })
                this.remove(true);
                return;
            }
            else if (thiz.isEntity(value)) {
                thiz.setValueAtPath(entity, path, value);
                this.remove(true);
                return;
            }
            if (this.notLeaf) {
                return;
            }
            // Per logic in traverse, it seems a leaf object is an empty object
            if (_.isObject(value)) {
                return;
            }
            if (value === config.syntax.deletionToken) {
                thiz.setValueAtPath(entity, path, undefined);
            }
            else {
                thiz.setValueAtPath(entity, path, value);
            }
        })
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

