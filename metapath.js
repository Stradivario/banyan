var metapath = require("metapath");

module.exports = metapath
    .from(__dirname)
    .add("/metapath")
    .to("/banyan")
    .to("/banyan[banyan]")
    .compose();