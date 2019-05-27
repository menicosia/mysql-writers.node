// Watch mysql-writers client

window.onload = init ;
var meterWidth = 120 ;
var meterHeight = 10 ;
var numInstances = 0 ;
var instanceValues = {} ;

function init () {
    getInstanceBits() ;
    setInterval(updateAllInstances, 2000) ;
    setInterval(showInstanceStatus, 2000) ;

    var incrButton = document.getElementById("incrInst") ;
    incrButton.onclick = incrInstances ;
    var decrButton = document.getElementById("decrInst") ;
    decrButton.onclick = decrInstances ;
}

function incrInstances() {
    numInstances = document.getElementById("numInstances").value ;
    numInstances++ ;
    document.getElementById("numInstances").value = numInstances ;
    updateAllInstances() ;
    return(1) ;
}

function decrInstances() {
    if (0 < numInstances) {
        numInstances = document.getElementById("numInstances").value ;
        numInstances-- ;
        document.getElementById("numInstances").value = numInstances ;
    }
    updateAllInstances() ;
    return(1) ;
}

function updateAllInstances() {
    numInstances = document.getElementById("numInstances").value ;

    // Make sure we request a 0th indexed array.
    for (var i = numInstances-1 ; i >= 0 ; i--) {
        getInstanceBits(i) ;
    }
}

function getInstanceBits(i) {
    var url = document.baseURI + "json/instanceInfo?" + i ;
    var request = new XMLHttpRequest() ;
    request.onload = function () {
        if (200 == request.status) {
            instanceValues[i] = JSON.parse(request.response) ;
            // showInstanceBits(i, request.response) ;
        } else {
            console.log("Failed to get data from server.") ;
        }
    }
    request.open("GET", url) ;
    request.send(null) ;
}

function showInstanceStatus() {
    var writerState = document.getElementById('writer-state') ;
    children = writerState.childNodes ;
    if (children) {
        for (var i = children.length-1; i >= 0; i--) {
            writerState.removeChild(children[i]) ;
        }
    }

    instanceTable = document.createElement("table") ;
    headerRow = document.createElement("tr") ;
    var cell = [] ;
    for (var i in [0, 1, 2]) {
        cell[i] = document.createElement("th") ;
    }
    cell[0].innerHTML = "Instance" ;
    cell[1].innerHTML = "Txn/Sec" ;
    cell[2].innerHTML = "Sec since last txn" ;
    for (var i in [0, 1, 2]) { headerRow.appendChild(cell[i]) ; }
    instanceTable.appendChild(headerRow) ;
    writerState.appendChild(instanceTable) ;
    
    for (var i = 0 ; i < numInstances ; i++) {
        var instance = instanceValues[i] ;
        var iCells = [] ;
        var newRow = document.createElement("tr") ;
        for (var q in [0, 1, 2]) {
            iCells[q] = document.createElement("td") ;
        }
        iCells[0].innerHTML = i ;
        iCells[1].innerHTML = instance["numTxnsLastSec"] ;
        // spanB = document.createElement("div") ;
        // spanB.innerHTML = "Sec since last txn: \n" ;
        // spanB.class = "f1" ;
        // writerState.appendChild(spanA) ;
        // writerState.appendChild(spanB) ;
        // writerState.appendChild(document.createElement("br")) ;
        for (var j in [0, 1, 2]) {
            newRow.appendChild(iCells[j]) ;
        }
        instanceTable.appendChild(newRow) ;
        timeDelta = (Math.round((Date.now()/1000))
                     - instance["lastTxnSuccess"]) ;
        drawMeter(iCells[2], i, timeDelta) ;
    }
}
