// Place a canvas within the supplied element
// Do not make the size dynamic, just expect the window to be large enough
// The content of the canvas is effectively two squares; one red, one green
// The magnitude of the red is indicated by the argument
// Provide an id (ie, an index) to uniquely name the elements
module.exports.drawMeter(element, id, magnitude) {
    var canvas = null ;
    var context = null ;
    var canvasID = "meterCanvas" + id ;

    newCanvas = document.createElement("canvas") ;
    newCanvas.height = meterHeight ;
    newCanvas.width = meterWidth ;
    newCanvas.id = canvasID ;

    element.appendChild(newCanvas) ;

    canvas = document.getElementById(canvasID);
    var context = canvas.getContext("2d") ;
    context.fillStyle="red" ;
    context.fillRect(0, 0, magnitude, meterHeight) ;
    context.fillStyle="lightGreen" ;
    context.fillRect(magnitude, 0, meterWidth-magnitude, meterHeight) ;

    return(1) ;
}
