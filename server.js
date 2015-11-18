require("node-polyfill");

var _ = require("underscore");
var q = require("q");
var shared = require("./shared.js");
var config = require("./config.js");

var Repository = Object.extend({
    initialize:function(options) {
        return this;
    },
    fetch:function(operation, options) {
        var registeredResource = shared.Resource.lookup(operation.query[config.syntax.metaKey][config.syntax.resourceKey]);
        if (registeredResource) {
            return registeredResource.fetch(operation)
        }
        else {
            // TODO construct an error object inside the metadata of the resposne entity, which should have the same
            // resource and id as the data
        }
    },
    patch:function(operation, options) {
        var registeredResource = shared.Resource.lookup(operation.data[config.syntax.metaKey][config.syntax.resourceKey]);
        if (registeredResource) {
            return registeredResource.patch(operation);
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
                if (operation.query) {
                    return repository
                        .fetch(operation)
                        .then(function(results) {
                            var operations = results.map(function(result) {
                                return {
                                    data:result
                                }
                            })
                            return operations;
                        })
                        .fail(function(e) {
                            console.log(e);
                        })
                }
                else if (operation.data) {
                    return repository
                        .patch(operation)
                        .then(function(results) {
                            var operations = results.map(function(result) {
                                return {
                                    data:result
                                }
                            })
                            return operations;
                        })
                        .fail(function(e) {
                            console.log(e);
                        })
                }
            }.bind(this)))
    }
})

var dispatcher = module.exports.dispatcher = Dispatcher.new();

var ResourceMixin = module.exports.ResourceMixin = Object.extend({
    fetchTemplates:{
    },
    patchTemplates:{
    },
    buildQueryStatement:function(key, query, options) {
        var fetchTemplate = this.fetchTemplates[key];
        if (!fetchTemplate) {
            throw "Cannot build query string for resource "+this.resourceName+" because key "+key+" was not found in query template map.";
        }
        if (_.isFunction(fetchTemplate)) {
            return fetchTemplate.call(this, query, options);
        }
        else {
            return fetchTemplate;
        }
    },
    runFetchStatement:function(statement, operation) {
        return q([]);
    },
    fetch:function(operation) {
        var fetchKey = operation.fetchKey;
        if (!fetchKey) {
            throw "Ad hoc queries are not currently supported."
        }
        var statement = this.buildQueryStatement(fetchKey, operation.query);
        return this.runFetchStatement(statement, operation)
    },
    patch:function(operation) {

    }
})