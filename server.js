require("node-polyfill");

var _ = require("underscore");
var q = require("q");
var Queue = require("./queue.js");
var Entity = require("./entity.js");
var Resource = require("./resource.js");
var Config = require("./config.js");

var Repository = Object.extend({
    initialize:function(options) {
        return this;
    },
    fetch:function(data, options) {
        var registeredResource = Resource.lookup(data[Config.metaKey][Config.resourceKey]);
        if (registeredResource) {
            return registeredResource.fetch(data);
        }
        else {
            // TODO construct an error object inside the metadata of the resposne entity, which should have the same
            // resource and id as the data
        }
    },
    patch:function(data, options) {
        var registeredResource = Resource.lookup(data[Config.metaKey][Config.resourceKey]);
        if (registeredResource) {
            return registeredResource.patch(data);
        }
        else {
            // TODO construct an error object inside the metadata of the resposne entity, which should have the same
            // resource and id as the data
        }
    }
})

var repository = module.exports.repository = Repository.new();

var Dispatcher = Object.extend({
    initialize:function(options) {
        return this;
    },
    route:function(operations, options) {
        var operations = operations;
        return q
            .all(operations.map(function(operation) {
                if (operation.fetch) {
                    return repository.fetch(operation.fetch);
                }
                else if (operation.patch) {
                    return repository.patch(operation.patch);
                }
            }.bind(this)))
            .then(function(results) {
                return _.flatten(results);
            })
    }
})

var dispatcher = module.exports.dispatcher = Dispatcher.new();

