require("node-polyfill");

var log = require("loglevel");
var _ = require("underscore");
var q = require("q");
var shared = require("./shared.js");
var config = require("./config.js");

var Dispatcher = Object.extend({
    initialize:function(options) {
        return this;
    },
    route:function(operations) {
        var process = function(operation) {
            var registeredResource = shared.Resource.lookup(operation[config.syntax.metaKey]._r);
            var operationKey = operation[config.syntax.metaKey]._op;
            operationKey = operationKey||shared.Resource.operations.patch;
            return registeredResource[operationKey](operation)
                .fail(function(e) {
                    // TODO
                    // need to determine where to handle errors such as version mismatches, and how to return
                    // meaningful errors
                    var message = "Operation execution on registered resource failed.";
                    log.error(e);
                    throw {
                        message:message,
                        resource:registeredResource,
                        operationKey:operationKey,
                        operation:operation
                    }
                })
        }.bind(this);

        /*
        TODO
        The sequence enforcement below is crude, it forces serial execution of batched operations always, and it only really
        guarantees a deterministic result for operations batched in a single request.  It does not make any 100% guarantee
        even for a single user making multiple requests that overlap each other, which may happen in a weak network
        environment, where request A and B on the same entity may be made in sequence on the client but may reach the server
        close enough in time that the findExisting+updateExisting database statements fo the two requests intersect.  This may
        cause the version query on one of these to turn up nothing in the findExisting.  In this case, *even though* on the
        client the operation completion indicator for the second operation will show, it does not imply the first operation
        also completed.  This scenario may be rare, since findExisting and updateExisting are fast operations, but there is
        no guarantee.
         */
        if (_.isArray(operations)) {

            return operations.reduce(function (promises, currentOperation) {
                return promises
                    .then(function(results) {
                        return [
                            results,
                            process(currentOperation)
                        ]
                    })
                    .spread(function(results, result) {
                        results.push(result);
                        return results;
                    })
            }, q([]));
        }
        else {
            return process(operations);
        }
    }
})

var dispatcher = module.exports.dispatcher = Dispatcher.new();

var ResourceMixin = module.exports.ResourceMixin = Object.extend({
})
