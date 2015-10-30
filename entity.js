var _ = require("underscore");
var Resource = require("./resource.js");
var Observe = require("observe-js");
var ObjectPath = require("object-path");
var config = require("./config.js");
var Traverse = require("traverse");
var extend = require("node.extend");

var arrayPathPattern = /[\[\]]]/g;
var objectPathDelimiterPattern = /\./g;
var backPathPattern = /[^.]+\.\.\.\./g;

var normalizePath = module.exports.normalizePath = function(observePath) {
    var objectPath = observePath.replace(arrayPathPattern, ".");
    var length = 0;
    while (length!==objectPath.length) {
        length = objectPath.length;
        objectPath = objectPath.replace(backPathPattern, "");
    }
    return objectPath;
}

var buildPath = module.exports.buildPath = function(parts) {
    return normalizePath(parts.join("."));
}

var buildMetadataPath = module.exports.buildMetadataPath = function(path) {
    var normalizedPath = this.normalizePath(path);
    var parts = normalizedPath.split(objectPathDelimiterPattern);
    var metadataPath = this.buildPath([
        normalizedPath,
        "..",
        config.syntax.metaKey,
        _.last(parts)
    ]);
    return metadataPath;
}

var getMetaData = module.exports.getMetadata = function(entity, path) {
    if (!path) {
        return {};
    }
    else if (_.isObject(path)) {
        return path[config.syntax.metaKey]||{};
    }
    else if (_.isString(path)) {
        var metadataPath = buildMetadataPath(path);
        return ObjectPath.get(entity, metadataPath)||{};
    }
}

var isEntity = module.exports.isEntity = function (object) {
    return (_.isObject(object)) && (config.syntax.idKey in object) && (config.syntax.metaKey in object) && (config.syntax.resourceKey in object[config.syntax.metaKey]);
}

var getGuid = module.exports.getGuid = function (entity) {
    return createGuid(entity[config.syntax.metaKey][config.syntax.resourceKey], entity[config.syntax.idKey]);
}

var createGuid = module.exports.createGuid = function(resource, id) {
    return resource+"/"+id;
}

var getVersion = module.exports.getVersion = function (entity) {
    return entity[config.syntax.metaKey][config.syntax.versionKey];
}

var getResource = module.exports.getResource = function (entity) {
    if (!entity) {
        return undefined;
    }
    else {
        return Resource.lookup(entity[config.syntax.metaKey][config.syntax.resourceKey]);
    }
}

var getId = module.exports.getId = function (entity) {
    return entity[config.syntax.idKey];
}

var buildEntityProxy = module.exports.buildEntityProxy = function(resource, id) {
    var entityProxy = {};
    entityProxy[config.syntax.idKey] = id;
    entityProxy[config.syntax.metaKey] = {};
    entityProxy[config.syntax.metaKey][config.syntax.resourceKey] = resource;
    return entityProxy;
}

var getEntityProxy = module.exports.getEntityProxy = function (entity) {
    var entityProxy = {};
    if (isEntity(entity)) {
        entityProxy[config.syntax.idKey] = entity[config.syntax.idKey];
        entityProxy[config.syntax.metaKey] = _.pick(entity[config.syntax.metaKey], config.syntax.versionKey, config.syntax.resourceKey)
        return entityProxy;
    }
    else {
        return undefined;
    }
}

var getValueAtPath = module.exports.getValueAtPath = function(entity, path) {
    if (""===path) {
        return entity
    }
    else {
        return Observe.Path.get(path).getValueFrom(entity);
    }
}

var getOrCreateValueAtPath = module.exports.getOrCreateValueAtPath = function(entity, path, defaultValue) {
    if (""===path) {
        return entity
    }
    else {
        var objectPath = normalizePath(path);
        var value = ObjectPath.get(entity, objectPath);
        if (_.isUndefined(value)) {
            value = defaultValue;
            ObjectPath.set(entity, objectPath, value)
        }
        return value;
    }
}

var setValueAtPath = module.exports.setValueAtPath = function(entity, path, value) {
    if (""===path) {
        return;
    }
    else {
        ObjectPath.set(entity, normalizePath(path), value);
    }
}

var joinPath = module.exports.joinPath = function(root, suffix) {
    if (""===root) {
        return suffix;
    }
    else {
        return root+"."+suffix;
    }
}

var createPatchOperation = module.exports.createPatchOperation = function(patch, options) {
    return {
        patch:patch
    }
}

var createPatch = module.exports.createPatch = function(entity, patchData, options) {
    var patch = extend(true, {}, patchData);
    patch[config.syntax.idKey] = entity[config.syntax.idKey];
    patch[config.syntax.metaKey] = _.pick(entity[config.syntax.metaKey], config.syntax.resourceKey, config.syntax.versionKey);
    return patch;
}

var createFetchOperation = module.exports.createFetchOperation = function(fetch, options) {
    return {
        fetch:fetch
    }
}

var createFetch = module.exports.createFetch = function(resource, fetchData, options) {
    var fetch = extend(true, {}, fetchData)
    fetch[config.syntax.metaKey] = {};
    fetch[config.syntax.metaKey][config.syntax.resourceKey] = resource;
    return fetch;
}

var PATCH_MODE_NONE = module.exports.PATCH_MODE_NONE = 0;
var PATCH_MODE_MERGE = module.exports.PATCH_MODE_MERGE = 1;
var PATCH_MODE_REPLACE = module.exports.PATCH_MODE_REPLACE = 2;

var getPatchMode = module.exports.getPatchMode = function(entity, patch) {
    if (!patch[config.syntax.metaKey]||!patch[config.syntax.metaKey][config.syntax.versionKey]) {
        return PATCH_MODE_NONE;
    }
    if (!entity[config.syntax.metaKey]||!entity[config.syntax.metaKey][config.syntax.versionKey]) {
        return PATCH_MODE_REPLACE;
    }
    if (entity[config.syntax.metaKey][config.syntax.versionKey]===patch[config.syntax.metaKey][config.syntax.versionKey]) {
        return PATCH_MODE_MERGE;
    }
}

var operationReplacer = module.exports.operationReplacer = function(key, value) {
    if (key===config.syntax.metaKey) {
        return _.pick(value, config.syntax.resourceKey, config.syntax.versionKey);
    }
    else {
        return value;
    }
}

var strip = module.exports.strip = function(root, options) {
    Traverse(root).forEach(function(value) {
        if (this.isRoot) {
            return;
        }
        else if (this.key===config.syntax.idKey||this.key===config.syntax.resourceKey) {
            return;
        }
        else if (this.key===config.syntax.observerKey) {
            this.remove();
        }
        else if (isEntity(value)||!(_.isObject(value))) {
            this.remove();
        }
    })
}
