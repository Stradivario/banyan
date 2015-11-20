require("node-polyfill");

var _ = require("underscore");
var q = require("q");
var shared = require("./shared.js");
var config = require("./config.js");

var Dispatcher = Object.extend({
    initialize:function(options) {
        return this;
    },
    route:function(operations, options) {
        return q
            .all(operations.map(function(operation) {
                var registeredResource = shared.Resource.lookup(operation[config.syntax.metaKey]._r);
                var operationKey = shared.Resource.lookup(operation[config.syntax.metaKey]._op);
                operationKey = operationKey||shared.Resource.patch;
                return registeredResource[operationKey](operation)
                    .fail(function(e) {
                        console.log(e);
                    })
            }.bind(this)))
    }
})

var dispatcher = module.exports.dispatcher = Dispatcher.new();

var ResourceMixin = module.exports.ResourceMixin = Object.extend({
})
