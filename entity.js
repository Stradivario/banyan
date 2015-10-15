var _ = require("underscore");
var Observe = require("observe-js");
var ObjectPath = require("object-path");
var Config = require("./config.js");

var arrayPathPattern = /[\[\]]]/g;

var toObjectPath = module.exports.toObjectPath = function(observePath) {
    return observePath.replace(arrayPathPattern, ".");
}

var isEntity = module.exports.isEntity = function (object) {
    return (_.isObject(object)) && (Config.idKey in object) && (Config.metaKey in object) && (Config.resourceKey in object[Config.metaKey]);
}

var getGuid = module.exports.getGuid = function (entity) {
    return createGuid(entity[Config.metaKey][Config.resourceKey], entity[Config.idKey]);
}

var createGuid = module.exports.createGuid = function(resource, id) {
    return resource+"/"+id;
}

var getVersion = module.exports.getVersion = function (entity) {
    return entity[Config.metaKey][Config.versionKey];
}

var getResource = module.exports.getResource = function (entity) {
    return entity[Config.metaKey][Config.resourceKey];
}

var getId = module.exports.getId = function (entity) {
    return entity[Config.idKey];
}

var buildEntityProxy = module.exports.buildEntityProxy = function(resource, id) {
    var entityProxy = {};
    entityProxy[Config.idKey] = id;
    entityProxy[Config.metaKey] = {};
    entityProxy[Config.metaKey][Config.resourceKey] = resource;
    return entityProxy;
}

var getEntityProxy = module.exports.getEntityProxy = function (entity) {
    var entityProxy = {};
    if (isEntity(entity)) {
        entityProxy[Config.idKey] = entity[Config.idKey];
        entityProxy[Config.metaKey] = _.pick(entity[Config.metaKey], Config.versionKey, Config.resourceKey)
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
        var objectPath = toObjectPath(path);
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
        ObjectPath.set(entity, toObjectPath(path), value);
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

var createPatchOperation = module.exports.createPatchOperation = function(entity, options) {
    var operation = {};
    operation.patch = _.pick(entity, Config.idKey);
    operation.patch[Config.metaKey] = _.pick(entity[Config.metaKey], Config.resourceKey, Config.versionKey);
    return operation;
}

var createFetchOperation = module.exports.createFetchOperation = function(resource, options) {
    var operation = {
        fetch:{}
    };
    operation.fetch[Config.metaKey] = {};
    operation.fetch[Config.metaKey][Config.resourceKey] = resource;
    return operation;
}


