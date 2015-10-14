require("node-polyfill");

var _ = require("underscore");
var q = require("q");
var Queue = require("./queue.js");
var Entity = require("./entity.js");
var Config = require("./config.js");

var Repository = Object.extend({
    initialize:function(options) {
        this.resources = {};
        return this;
    },
    registerResource:function(resource, options) {
        if (resource.name in this.resources) {
            throw "Cannot register a resource under the name "+resource.name+" because this name already exists in the resource registry."
        }
        this.resources[resource.name] = resource;
    },
    fetch:function(data, options) {
        var Resource = this.resources[data[Config.metaKey][Config.resourceKey]];
        if (Resource) {
            return Resource.fetch(data);
        }
        else {
            // TODO construct an error object inside the metadata of the resposne entity, which should have the same
            // resource and id as the data
        }
    },
    patch:function(data, options) {
        var Resource = this.resources[data[Config.metaKey][Config.resourceKey]];
        if (Resource) {
            return Resource.patch(data);
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

