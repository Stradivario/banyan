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
        var process = function(operation) {
            var registeredResource = shared.Resource.lookup(operation[config.syntax.metaKey]._r);
            var operationKey = operation[config.syntax.metaKey]._op;
            operationKey = operationKey||shared.Resource.patch;
            return registeredResource[operationKey](operation)
                .fail(function(e) {
                    // TODO
                    // need to determine where to handle errors such as version mismatches, and how to return
                    // meaningful errors
                    console.log(e);
                })
        }.bind(this);

        if (_.isArray(operations)) {
            return q.all(operations.map(process))
        }
        else {
            return process(operations);
        }
    }
})

var dispatcher = module.exports.dispatcher = Dispatcher.new();

var ResourceMixin = module.exports.ResourceMixin = Object.extend({
})
