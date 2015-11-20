var _ = require("underscore");
var extend = require("node.extend");

module.exports = {
    syntax:{
        idKey: "id",
        metaKey: "_m",
        versionKey: "_v",
        validationPath:"valid",
        deletionToken: null
    },
    initialize:function(options) {
        extend(true, module.exports, _.omit(options, "initialize"));
    }
}
