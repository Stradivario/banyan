var _ = require("underscore");
var Observe = require("observe-js");
var Config = require("metapath:///banyan/shared/config.js");

var isEntity = module.exports.isEntity = function (object) {
    return (_.isObject(object)) && (Config.idKey in object) && (Config.metaKey in object) && (Config.resourceKey in object[Config.metaKey]);
}

var getGuid = module.exports.getGuid = function (entity) {
    return entity[Config.metaKey][Config.resourceKey] + "/" + entity[Config.idKey];
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

var getIdentityProxy = module.exports.getIdentityProxy = function (entity) {
    var identityProxy = {};
    if (isEntity(entity)) {
        identityProxy[Config.idKey] = entity[Config.idKey];
        identityProxy[Config.metaKey] = _.pick(entity[Config.metaKey], Config.versionKey, Config.resourceKey)
        return identityProxy;
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
        var value = Observe.Path.get(path).getValueFrom(entity);
        if (_.isUndefined(value)) {
            value = defaultValue;
            Observe.Path.get(path).setValueFrom(entity, value);
        }
        return value;
    }
}

var setValueAtPath = module.exports.setValueAtPath = function(entity, path, value) {
    if (""===path) {
        return;
    }
    else {
        Observe.Path.get(path).setValueFrom(entity, value);
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

var createOperation = module.exports.createOperation = function(entity, options) {
    var operation = {};
    operation.delta = _.pick(entity, Config.idKey);
    operation.delta[Config.metaKey] = _.pick(entity[Config.metaKey], Config.resourceKey, Config.versionKey);
    return operation;
}



