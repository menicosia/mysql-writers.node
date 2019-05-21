// Watch mysql-writers client

window.onload = init ;
var meterWidth = 60 ;
var meterHeight = 10 ;
var numInstances = 1 ;

function init () {
    // getInstanceBits() ;
    setInterval(drawAllMeters, 2000) ;

    // window.onresize = resizeToWindow ;
    var updateButton = document.getElementById("updateInstances") ;
    updateButton.onclick = drawAllMeters ;
}

function resizeToWindow () {
    dataWidth = window.innerWidth > 20 ? window.innerWidth - 20 : -1; // Allow 5px border
    maxDataHeight = window.innerHeight - 2 ;
    // draw(dataWidth, maxDataHeight, timeSeries) ;
}

function bitmaskArray() {
    var bitmasks = [] ;
    for (var i = 0; i < 8; i++) {
        var bitmask = Math.pow(2, i) ;
        bitmasks.push(bitmask) ;
    }
}

function getInstanceBits() {
    var url = document.baseURI + "json/instanceInfo?0" ;
    var request = new XMLHttpRequest() ;
    request.onload = function () {
        if (200 == request.status) {
            showInstanceBits(request.response) ;
        } else {
            console.log("Failed to get data from server.") ;
        }
    }
    request.open("GET", url) ;
    request.send(null) ;
}

function showInstanceBits(response) {
    instanceInfo = JSON.parse(response) ;
    showCurCount(instanceInfo) ;
    // draw(dataWidth, maxDataHeight, timeSeries) ;
}

function showCurCount(instanceInfo) {
    var writerState = document.getElementById('writer-state') ;
    timeDelta = Math.round((Date.now()/1000)) - instanceInfo["lastTxnSuccess"] ;
    instances[0] = "<p>Instance 0:<ul><li>Txns last sec: " + instanceInfo["numTxnsLastSec"]
        + "</li><li>Seconds since last txn: " + timeDelta + "</li></ul></p>\n" ;
    writerState.innerHTML = instances[0] ;
}


function drawAllMeters(e) {
    // Get rid of any existing canvases
    metersPlace = document.getElementById("metersHere") ;
    childMeters = metersPlace.childNodes ;
    if (childMeters) {
        console.log("len children: " + childMeters.length) ;
        for (var i = childMeters.length-1; i >= 0; i--) {
            console.log("removing element") ;
            metersPlace.removeChild(childMeters[i]) ;
        }
    }
        
    numInstances = document.getElementById("numInstances") ;
    console.log("creating " + numInstances.value + " meters") ;
    for (var i = numInstances.value ; i > 0 ; i-- ) {
        console.log("creating meter...") ;
        drawMeter(metersPlace, i, ((Math.random() * 100) % 60)) ;
    }
}

// Place a canvas within the supplied element
// Do not make the size dynamic, just expect the window to be large enough
// The content of the canvas is effectively two squares; one red, one green
// The magnitude of the red is indicated by the argument
// Provide an id (ie, an index) to uniquely name the elements
function drawMeter(element, id, magnitude) {
    var canvas = null ;
    var context = null ;
    var canvasID = "meterCanvas" + id ;

    newCanvas = document.createElement("canvas") ;
    newCanvas.height = meterHeight ;
    newCanvas.width = meterWidth ;
    newCanvas.id = canvasID ;
    element.appendChild(newCanvas) ;
    element.appendChild(document.createElement("br")) ;

    canvas = document.getElementById(canvasID);
    var context = canvas.getContext("2d") ;
    context.fillStyle="red" ;
    context.fillRect(0, 0, magnitude, meterHeight) ;
    context.fillStyle="lightGreen" ;
    context.fillRect(magnitude, 0, meterWidth-magnitude, meterHeight) ;

    return(1) ;
}
