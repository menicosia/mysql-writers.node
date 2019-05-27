// Watch mysql-writers client

window.onload = init ;
var meterWidth = 360 ;
var meterHeight = 40 ;

function init () {
    setInterval(getReplicationStatus, 2000) ;
}

function showReplicationStatus(response) {
    var followerState = document.getElementById('follower-state') ;
    children = followerState.childNodes ;
    if (children) {
        for (var i = children.length-1; i >= 0; i--) {
            followerState.removeChild(children[i]) ;
        }
    }

    lastTS = Math.round(Date.parse(response["ts"])/1000) ;
    now = Math.round(Date.now()/1000) ;
    console.log("Last timestamp: " + lastTS
                + "Current Date: " + now) ;
    timeDelta = (now - lastTS) ;
    drawMeter(followerState, 0, timeDelta) ;
}

function getReplicationStatus() {
    var url = document.baseURI + "json/followerStatus" ;
    var request = new XMLHttpRequest() ;
    request.onload = function() {
        if (200 == request.status) {
            showReplicationStatus(JSON.parse(request.response)) ;
        } else {
            console.log("Failed to get data from server.") ;
        }
    }
    request.open("GET", url) ;
    request.send(null) ;
}

