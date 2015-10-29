var _ = require("underscore");
var extend = require("node.extend");

module.exports = {
    idKey: "id",
    metaKey: "_m",
    versionKey: "_v",
    resourceKey: "_r",
    observerKey:"_o",
    validationKey:"valid",
    validationStateKey:"state",
    validationMessageKey:"message",
    deletionToken: null,
    initialize:function(configuration) {
        extend(true, module.exports, _.omit(configuration, "initialize"));
    }
}
