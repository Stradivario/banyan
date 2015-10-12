var EventEmitter2 = require("eventemitter2").EventEmitter2;

var bus = module.exports.bus = new EventEmitter2();

var messages = module.exports.messages = {
}