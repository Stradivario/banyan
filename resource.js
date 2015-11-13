require("node-polyfill");

var _ = require("underscore");
var ObjectPath = require("object-path");

var Resource = module.exports = Object.extend({
    registry:{},
    validationStates:{
        valid:"valid",
        invalid:"invalid"
    },
    validators:Object.extend({}),
    resourceName:undefined,
    template:{},
    register:function(resource, options) {
        if (_.isArray(resource)) {
            resource.forEach(function(resourceItem) {
                this.register(resourceItem, options);
            }.bind(this));
            return;
        }
        if (resource.resourceName in Resource.registry) {
            throw "Cannot register a resource under the name "+resource.resourceName+" because this name already exists in the resource registry."
        }
        Resource.registry[resource.resourceName] = resource;
    },
    lookup:function(name) {
        return Resource.registry[name];
    },
    validate:function(path, value) {
        var validator = ObjectPath.get(this.validators, path);
        var validation;
        if (!validator) {
            validation = {
                state:Resource.validationStates.valid
            }
        }
        else {
            validation = validator(value);
        }
        return validation;
    }
})