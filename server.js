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
    consumeOperation:function(operation, options) {

    }
})

var repository = module.exports.repository = Repository.new();

var Dispatcher = Object.extend({
    initialize:function(options) {
        return this;
    },
    route:function(data, options) {
        var operations = data.operations;
        return q
            .all(operations.map(function(operation) {
                return repository.consumeOperation(operation);
            }.bind(this)))
            .then(function(results) {
                return _.flatten(results);
            })
    }
})

var dispatcher = module.exports.dispatcher = Dispatcher.new();

