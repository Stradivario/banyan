var test = require("tape");
var Client = require("../client.js");

test("Test track", function (t) {
    var store = Client.Store.new();

    var o1 = {
        p1:1,
        a1:[
            {
                p1:1
            },
            {
                p1:1
            }
        ]
    }

    var e1 = {
        _m:{
            _version:"1",
            _r:"o"
        },
        id:1,
        p1:1,
        o1:o1
    }

    var e2 = {
        _m:{
            _version:"1",
            _r:"o"
        },
        id:2,
        p1:1
    }

    var o2 = {
        p2:2,
        a2:[
            {
                p2:2
            },
            {
                p2:2
            }
        ]
    }

    store.track(e1);
    setTimeout(function() {
        e1.o1 = o2;
    }, 100)
    setTimeout(function() {
        o2.p2 = 4;
    }, 200)
    setTimeout(function() {
        e1.o1.a2.push({
            p2:3
        });
    }, 300)
    setTimeout(function() {
        e1.e2 = e2;
    }, 400)
});

