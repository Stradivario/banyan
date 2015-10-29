var _ = require("underscore");
var Resource = require("./resource.js");
var Observe = require("observe-js");
var ObjectPath = require("object-path");
var config = require("./config.js");
var Traverse = require("traverse");
var extend = require("node.extend");

var arrayPathPattern = /[\[\]]]/g;
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

var isEntity = module.exports.isEntity = function (object) {
    return (_.isObject(object)) && (config.idKey in object) && (config.metaKey in object) && (config.resourceKey in object[config.metaKey]);
}

var getGuid = module.exports.getGuid = function (entity) {
    return createGuid(entity[config.metaKey][config.resourceKey], entity[config.idKey]);
}

var createGuid = module.exports.createGuid = function(resource, id) {
    return resource+"/"+id;
}

var getVersion = module.exports.getVersion = function (entity) {
    return entity[config.metaKey][config.versionKey];
}

var getResource = module.exports.getResource = function (entity) {
    if (!entity) {
        return undefined;
    }
    else {
        return Resource.lookup(entity[config.metaKey][config.resourceKey]);
    }
}

var getId = module.exports.getId = function (entity) {
    return entity[config.idKey];
}

var buildEntityProxy = module.exports.buildEntityProxy = function(resource, id) {
    var entityProxy = {};
    entityProxy[config.idKey] = id;
    entityProxy[config.metaKey] = {};
    entityProxy[config.metaKey][config.resourceKey] = resource;
    return entityProxy;
}

var getEntityProxy = module.exports.getEntityProxy = function (entity) {
    var entityProxy = {};
    if (isEntity(entity)) {
        entityProxy[config.idKey] = entity[config.idKey];
        entityProxy[config.metaKey] = _.pick(entity[config.metaKey], config.versionKey, config.resourceKey)
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
    patch[config.idKey] = entity[config.idKey];
    patch[config.metaKey] = _.pick(entity[config.metaKey], config.resourceKey, config.versionKey);
    return patch;
}

var createFetchOperation = module.exports.createFetchOperation = function(fetch, options) {
    return {
        fetch:fetch
    }
}

var createFetch = module.exports.createFetch = function(resource, fetchData, options) {
    var fetch = extend(true, {}, fetchData)
    fetch[config.metaKey] = {};
    fetch[config.metaKey][config.resourceKey] = resource;
    return fetch;
}

var PATCH_MODE_NONE = module.exports.PATCH_MODE_NONE = 0;
var PATCH_MODE_MERGE = module.exports.PATCH_MODE_MERGE = 1;
var PATCH_MODE_REPLACE = module.exports.PATCH_MODE_REPLACE = 2;

var getPatchMode = module.exports.getPatchMode = function(entity, patch) {
    if (!patch[config.metaKey]||!patch[config.metaKey][config.versionKey]) {
        return PATCH_MODE_NONE;
    }
    if (!entity[config.metaKey]||!entity[config.metaKey][config.versionKey]) {
        return PATCH_MODE_REPLACE;
    }
    if (entity[config.metaKey][config.versionKey]===patch[config.metaKey][config.versionKey]) {
        return PATCH_MODE_MERGE;
    }
}

var operationReplacer = module.exports.operationReplacer = function(key, value) {
    if (key===config.metaKey) {
        return _.pick(value, config.resourceKey, config.versionKey);
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
        else if (this.key===config.idKey||this.key===config.resourceKey) {
            return;
        }
        else if (this.key===config.observerKey) {
            this.remove();
        }
        else if (isEntity(value)||!(_.isObject(value))) {
            this.remove();
        }
    })
}
