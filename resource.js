require("node-polyfill");

var _ = require("underscore");

var Resource = module.exports = Object.extend({
    registry:{},
    resourceName:undefined,
    template:{},
    register:function(resource, options) {
        if (resource.resourceName in Resource.registry) {
            throw "Cannot register a resource under the name "+resource.resourceName+" because this name already exists in the resource registry."
        }
        Resource.registry[resource.resourceName] = resource;
    },
    lookup:function(name) {
        return Resource.registry[name];
    }
})