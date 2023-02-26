var canvas = document.getElementById("canvas");
var PacmanPos = "right";
let count = 0;
let gameover = false;

var GAME = {
    width: 500,
    height: 500,
    background: new Image(),
}

var RESTART_BUTTON = {
    xPos: 190,
    yPos: 210,
    width: 120,
    height: 70,
}
GAME.background.src = "./img/bg.png"

var PACMAN = {
    fill: "black",
    line: "yellow",
    width: 2,
    xPos: 30,
    yPos: 30,
    radius: 10,
    xDirection: 0,
    yDirection: 0,
    direction: 2,
}

var GHOSTBLUE = {
    ghost: new Image(),
    xPos: 467, //467
    yPos: 459, //459
    radius: 8,
    xDirection: -1,
    yDirection: 0,
    movespeed: 1,
} //blue
GHOSTBLUE.ghost.src = "./img/ghostrightblue.png"

var GHOSTRED = {
    ghost: new Image(),
    xPos: 467, //467
    yPos: 28, //459
    radius: 8,
    xDirection: -1,
    yDirection: 0,
    movespeed: 1,
} //red

GHOSTRED.ghost.src = "./img/ghostrightred.png"

var GHOSTYELLOW = {
    ghost: new Image(),
    xPos: 28, //467
    yPos: 457, //459
    radius: 8,
    xDirection: 1,
    yDirection: 0,
    movespeed: 1,
} //yellow

GHOSTYELLOW.ghost.src = "./img/ghostrightyellow.png"

var walls = [
    {
        x: 190,
        y: 210,
        height: 70,
        width: 120,
    },
    {
        x: 410,
        y: 150,
        height: 70,
        width: 80,
    },

    {
        x: 10,
        y: 150,
        height: 70,
        width: 80,
    },

    {
        x: 410,
        y: 260,
        height: 70,
        width: 80,
    },
    {
        x: 10,
        y: 260,
        height: 70,
        width: 80,
    },
    {
        x: 490,
        y: 260,
        height: 240,
        width: 10,
    },

    {
        x: 0,
        y: 260,
        height: 240,
        width: 10,
    },
    {
        x: 490,
        y: 0,
        height: 220,
        width: 10,
    },
    {
        x: 0,
        y: 0,
        height: 220,
        width: 10,
    },
    {
        x: 130,
        y: 50,
        height: 10,
        width: 70,
    },
    {
        x: 300,
        y: 50,
        height: 10,
        width: 70,
    },
    {
        x: 410,
        y: 50,
        height: 10,
        width: 40,
    },
    {
        x: 50,
        y: 50,
        height: 10,
        width: 40,
    },
    {
        x: 460,
        y: 420,
        height: 20,
        width: 30,
    },
    {
        x: 10,
        y: 420,
        height: 20,
        width: 30,
    },
    {
        x: 410,
        y: 100,
        height: 10,
        width: 40,
    },
    {
        x: 50,
        y: 100,
        height: 10,
        width: 40,
    },
    {
        x: 310,
        y: 380,
        height: 20,
        width: 50,
    },

    {
        x: 190,
        y: 440,
        height: 20,
        width: 120,
    },
    {
        x: 140,
        y: 380,
        height: 20,
        width: 50,
    },

    {
        x: 400,
        y: 370,
        height: 70,
        width: 20,
    },

    {
        x: 80,
        y: 370,
        height: 70,
        width: 20,
    },

    {
        x: 420,
        y: 370,
        height: 10,
        width: 30,
    },

    {
        x: 50,
        y: 370,
        height: 10,
        width: 40,
    },

    {
        x: 350,
        y: 440,
        height: 40,
        width: 10,
    },

    {
        x: 140,
        y: 440,
        height: 40,
        width: 10,
    },
    {
        x: 130,
        y: 260,
        height: 80,
        width: 20,
    },
    {
        x: 350,
        y: 260,
        height: 80,
        width: 20,
    },
    {
        x: 350,
        y: 100,
        height: 120,
        width: 20,
    },
    {
        x: 230,
        y: 340,
        height: 60,
        width: 40,
    },
    {
        x: 230,
        y: 110,
        height: 60,
        width: 40,
    },
    {
        x: 350,
        y: 480,
        height: 20,
        width: 140,
    },

    {
        x: 0,
        y: 0,
        height: 10,
        width: 500,
    },

    {
        x: 10,
        y: 480,
        height: 20,
        width: 140,
    },

    {
        x: 190,
        y: 320,
        height: 20,
        width: 120,
    },

    {
        x: 190,
        y: 100,
        height: 10,
        width: 120,
    },

    {
        x: 310,
        y: 150,
        height: 20,
        width: 40,
    },

    {
        x: 150,
        y: 150,
        height: 20,
        width: 40,
    },

    {
        x: 130,
        y: 100,
        height: 120,
        width: 20,
    },

    {
        x: 240,
        y: 10,
        height: 50,
        width: 20,
    },


]

const POINTCOLOR = "LightGoldenRodYellow";
const POINTSIZE = 5;
var points = [
    {
        x: 107,
        y: 52,

    },

    {
        x: 107,
        y: 77,
    },
    {
        x: 436,
        y: 398,

    },

    {
        x: 467,
        y: 398,
    }, {
        x: 436,
        y: 427,

    },

    {
        x: 55,
        y: 349,
    }, {
        x: 85,
        y: 349,

    },

    {
        x: 25,
        y: 349,
    }, {
        x: 436,
        y: 347,

    },

    {
        x: 466,
        y: 347,
    }, {
        x: 467,
        y: 373,

    },

    {
        x: 436,
        y: 459,
    }, {
        x: 57,
        y: 457,

    },

    {
        x: 57,
        y: 427,
    }, {
        x: 57,
        y: 394,

    },

    {
        x: 88,
        y: 457,
    }, {
        x: 117,
        y: 457,

    },

    {
        x: 27,
        y: 457,
    }, {
        x: 378,
        y: 427,

    },

    {
        x: 378,
        y: 375,
    }, {
        x: 378,
        y: 401,

    },

    {
        x: 117,
        y: 427,
    }, {
        x: 117,
        y: 375,

    },

    {
        x: 117,
        y: 401,
    }, {
        x: 378,
        y: 459,

    },

    {
        x: 408,
        y: 459,
    }, {
        x: 467,
        y: 459,

    },

    {
        x: 207,
        y: 388,
    }, {
        x: 287,
        y: 388,

    },

    {
        x: 166,
        y: 326,
    }, {
        x: 137,
        y: 358,

    },

    {
        x: 166,
        y: 358,
    }, {
        x: 186,
        y: 358,

    },

    {
        x: 207,
        y: 358,
    }, {
        x: 287,
        y: 358,

    },

    {
        x: 287,
        y: 475,
    }, {
        x: 207,
        y: 475,

    },

    {
        x: 247,
        y: 475,
    }, {
        x: 328,
        y: 475,

    },

    {
        x: 167,
        y: 475,
    }, {
        x: 287,
        y: 417,

    },

    {
        x: 207,
        y: 417,
    }, {
        x: 247,
        y: 417,

    },

    {
        x: 315,
        y: 417,
    }, {
        x: 142,
        y: 417,

    },

    {
        x: 328,
        y: 448,
    }, {
        x: 167,
        y: 448,

    },

    {
        x: 179,
        y: 417,
    }, {
        x: 298,
        y: 295,

    },

    {
        x: 229,
        y: 295,
    }, {
        x: 262,
        y: 295,

    },

    {
        x: 469,
        y: 52,
    }, {
        x: 83,
        y: 130,

    },

    {
        x: 56,
        y: 130,
    }, {
        x: 28,
        y: 130,

    },

    {
        x: 468,
        y: 130,
    }, {
        x: 442,
        y: 130,

    },

    {
        x: 415,
        y: 130,
    }, {
        x: 469,
        y: 78,

    },

    {
        x: 442,
        y: 78,
    }, {
        x: 415,
        y: 78,

    },

    {
        x: 468,
        y: 102,
    }, {
        x: 25,
        y: 406,

    },

    {
        x: 25,
        y: 380,
    }, {
        x: 107,
        y: 331,

    },

    {
        x: 107,
        y: 306,
    }, {
        x: 107,
        y: 285,

    },

    {
        x: 107,
        y: 216,
    }, {
        x: 107,
        y: 262,

    },

    {
        x: 137,
        y: 239,
    }, {
        x: 107,
        y: 239,

    },

    {
        x: 107,
        y: 285,
    },
    {
        x: 107,
        y: 197,
    },
    {
        x: 107,
        y: 177,
    },
    {
        x: 107,
        y: 103,
    },
    {
        x: 107,
        y: 130,
    },
    {
        x: 107,
        y: 156,
    },
    {
        x: 107,
        y: 216,
    },
    {
        x: 107,
        y: 262,
    },
    {
        x: 107,
        y: 239,
    },
    {
        x: 387,
        y: 330,
    },
    {
        x: 387,
        y: 305,
    },
    {
        x: 353,
        y: 417,
    },
    {
        x: 387,
        y: 284,
    },
    {
        x: 387,
        y: 215,
    },
    {
        x: 387,
        y: 261,
    },
    {
        x: 387,
        y: 238,
    },
    {
        x: 387,
        y: 284,
    },
    {
        x: 327,
        y: 326,
    },
    {
        x: 307,
        y: 358,
    },
    {
        x: 327,
        y: 358,
    },
    {
        x: 357,
        y: 358,
    },
    {
        x: 406,
        y: 347,
    },
    {
        x: 387,
        y: 196,
    },
    {
        x: 387,
        y: 176,
    },
    {
        x: 386,
        y: 102,
    },
    {
        x: 387,
        y: 77,
    },
    {
        x: 387,
        y: 130,
    },
    {
        x: 387,
        y: 155,
    },
    {
        x: 327,
        y: 295,
    },
    {
        x: 166,
        y: 295,
    },
    {
        x: 196,
        y: 295,
    },
    {
        x: 18,
        y: 239,
    },
    {
        x: 58,
        y: 239,
    },
    {
        x: 36,
        y: 239,
    },
    {
        x: 79,
        y: 239,
    },
    {
        x: 410,
        y: 238,
    },
    {
        x: 387,
        y: 215,
    },
    {
        x: 387,
        y: 261,
    },
    {
        x: 456,
        y: 238,
    },
    {
        x: 434,
        y: 238,
    },
    {
        x: 357,
        y: 238,
    },
    {
        x: 387,
        y: 238,
    },
    {
        x: 475,
        y: 238,
    },
    {
        x: 298,
        y: 187,
    },
    {
        x: 229,
        y: 187,
    },
    {
        x: 262,
        y: 187,
    },
    {
        x: 327,
        y: 187,
    },
    {
        x: 166,
        y: 187,
    },
    {
        x: 196,
        y: 187,
    },
    {
        x: 298,
        y: 187,
    },
    {
        x: 327,
        y: 215,
    },
    {
        x: 229,
        y: 187,
    },
    {
        x: 262,
        y: 187,
    },
    {
        x: 327,
        y: 187,
    },
    {
        x: 166,
        y: 187,
    },
    {
        x: 327,
        y: 238,
    },
    {
        x: 327,
        y: 265,
    },
    {
        x: 166,
        y: 239,
    },
    {
        x: 166,
        y: 265,
    },
    {
        x: 166,
        y: 215,
    },
    {
        x: 196,
        y: 187,
    },
    {
        x: 289,
        y: 157,
    },
    {
        x: 289,
        y: 127,
    },
    {
        x: 206,
        y: 157,
    },
    {
        x: 206,
        y: 127,
    },
    {
        x: 327,
        y: 127,
    },
    {
        x: 327,
        y: 102,
    },
    {
        x: 167,
        y: 127,
    },
    {
        x: 167,
        y: 102,
    },
    {
        x: 217,
        y: 28,
    },
    {
        x: 188,
        y: 28,
    },
    {
        x: 161,
        y: 28,
    },
    {
        x: 134,
        y: 28,
    },
    {
        x: 107,
        y: 28,
    },
    {
        x: 78,
        y: 28,
    },
    {
        x: 51,
        y: 28,
    },
    {
        x: 469,
        y: 28,
    },
    {
        x: 442,
        y: 28,
    },
    {
        x: 415,
        y: 28,
    },
    {
        x: 388,
        y: 28,
    },
    {
        x: 359,
        y: 28,
    },
    {
        x: 28,
        y: 52,
    },
    {
        x: 387,
        y: 52,
    },
    {
        x: 277,
        y: 28,
    },
    {
        x: 217,
        y: 52,
    },
    {
        x: 277,
        y: 52,
    },
    {
        x: 357,
        y: 77,
    },
    {
        x: 328,
        y: 77,
    },
    {
        x: 303,
        y: 77,
    },
    {
        x: 277,
        y: 77,
    },
    {
        x: 247,
        y: 77,
    },
    {
        x: 332,
        y: 28,
    },
    {
        x: 305,
        y: 28,
    },
    {
        x: 193,
        y: 77,
    },
    {
        x: 217,
        y: 77,
    },
    {
        x: 167,
        y: 77,
    },

    {
        x: 137,
        y: 77,
    },
    {
        x: 28,
        y: 102,
    },
    {
        x: 28,
        y: 77,
    },
    {
        x: 67,
        y: 77,
    },

]
{
    function drawGhostBlue() {
        canvasContext.fillStyle = GHOSTBLUE.ghost;

        canvasContext.arc(GHOSTBLUE.xPos, GHOSTBLUE.yPos, GHOSTBLUE.radius, 0, 2 * Math.PI);

        canvasContext.drawImage(GHOSTBLUE.ghost, GHOSTBLUE.xPos - 8, GHOSTBLUE.yPos - 8);
    }

    function drawGhostRed() {
        canvasContext.fillStyle = GHOSTBLUE.ghost;

        canvasContext.arc(GHOSTRED.xPos, GHOSTRED.yPos, GHOSTRED.radius, 0, 2 * Math.PI);

        canvasContext.drawImage(GHOSTRED.ghost, GHOSTRED.xPos - 8, GHOSTRED.yPos - 8);
    }
    function drawGhostYellow() {
        canvasContext.fillStyle = GHOSTYELLOW.ghost;

        canvasContext.arc(GHOSTYELLOW.xPos, GHOSTYELLOW.yPos, GHOSTYELLOW.radius, 0, 2 * Math.PI);

        canvasContext.drawImage(GHOSTYELLOW.ghost, GHOSTYELLOW.xPos - 8, GHOSTYELLOW.yPos - 8);
    }
} // GHOSTS
function drawPoints() {
    for (var i = 0; i < points.length; i++) {
        canvasContext.fillStyle = POINTCOLOR;
        canvasContext.fillRect(points[i].x, points[i].y, POINTSIZE, POINTSIZE);
    }

} // POINTS



canvas.width = GAME.width;
canvas.height = GAME.height;
var canvasContext = canvas.getContext("2d");

function drawBackground() {
    canvasContext.drawImage(GAME.background, 0, 0);
}
function drawRestartButton() {
    canvasContext.fillStyle = PACMAN.fill;
    canvasContext.fillRect(RESTART_BUTTON.x, RESTART_BUTTON.y, RESTART_BUTTON.width, RESTART_BUTTON.height);
    canvasContext.fillStyle = "white";
    canvasContext.font = "10pt Inter";
    canvasContext.fillText("GAME OVER!", 207, 240);
    canvasContext.fillStyle = "white";
    canvasContext.font = "10pt Inter";
    canvasContext.fillText("F5 TO RESTART.", 202, 260);
}

function drawMenu() {
    drawRestartButton();
 
}

function drawPacManRightOpen() {
    canvasContext.fillStyle = PACMAN.fill;
    canvasContext.strokeStyle = PACMAN.line;
    canvasContext.lineWidth = PACMAN.width;
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos, PACMAN.yPos, PACMAN.radius, Math.PI / 4, 7 * Math.PI / 4);
    canvasContext.lineTo(PACMAN.xPos, PACMAN.yPos);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();
    pacmanLastPosX = PACMAN.xPos


    canvasContext.fillStyle = "yellow";
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos + 1, PACMAN.yPos - 5, 1, 0, 2 * Math.PI);
    canvasContext.closePath();
    canvasContext.fill();
}

function drawPacManRightClose() {
    canvasContext.fillStyle = PACMAN.fill;
    canvasContext.strokeStyle = PACMAN.line;
    canvasContext.lineWidth = PACMAN.width;
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos, PACMAN.yPos, PACMAN.radius, 0, 2 * Math.PI);
    canvasContext.lineTo(PACMAN.xPos, PACMAN.yPos);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    canvasContext.fillStyle = "yellow";
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos + 1, PACMAN.yPos - 5, 1, 0, 2 * Math.PI);
    canvasContext.closePath();
    canvasContext.fill();
}


function drawPacManLeftOpen() {
    canvasContext.fillStyle = PACMAN.fill;
    canvasContext.strokeStyle = PACMAN.line;
    canvasContext.lineWidth = PACMAN.width;
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos, PACMAN.yPos, PACMAN.radius, 7 / 6 * Math.PI, 3 / 4 * Math.PI);
    canvasContext.lineTo(PACMAN.xPos, PACMAN.yPos);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    canvasContext.fillStyle = "yellow";
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos + 1, PACMAN.yPos - 5, 1, 0, 2 * Math.PI);
    canvasContext.closePath();
    canvasContext.fill();
}

function drawPacManLeftClose() {
    canvasContext.fillStyle = PACMAN.fill;
    canvasContext.strokeStyle = PACMAN.line;
    canvasContext.lineWidth = PACMAN.width;
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos, PACMAN.yPos, PACMAN.radius, Math.PI, Math.PI - 0.01);
    canvasContext.lineTo(PACMAN.xPos, PACMAN.yPos);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    canvasContext.fillStyle = "yellow";
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos + 1, PACMAN.yPos - 5, 1, 0, 2 * Math.PI);
    canvasContext.closePath();
    canvasContext.fill();
}
function drawPacManTopOpen() {
    canvasContext.fillStyle = PACMAN.fill;
    canvasContext.strokeStyle = PACMAN.line;
    canvasContext.lineWidth = PACMAN.width;
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos, PACMAN.yPos, PACMAN.radius, 5 / 3 * Math.PI, 4 / 3 * Math.PI);
    canvasContext.lineTo(PACMAN.xPos, PACMAN.yPos);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    canvasContext.fillStyle = "yellow";
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos + 5, PACMAN.yPos - 2, 1, 0, 2 * Math.PI);
    canvasContext.closePath();
    canvasContext.fill();
}

function drawPacManTopClose() {
    canvasContext.fillStyle = PACMAN.fill;
    canvasContext.strokeStyle = PACMAN.line;
    canvasContext.lineWidth = PACMAN.width;
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos, PACMAN.yPos, PACMAN.radius, 3 / 2 * Math.PI, 3 / 2 * Math.PI - 0.01);
    canvasContext.lineTo(PACMAN.xPos, PACMAN.yPos);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    canvasContext.fillStyle = "yellow";
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos + 5, PACMAN.yPos - 2, 1, 0, 2 * Math.PI);
    canvasContext.closePath();
    canvasContext.fill();
}

function drawPacManDownOpen() {
    canvasContext.fillStyle = PACMAN.fill;
    canvasContext.strokeStyle = PACMAN.line;
    canvasContext.lineWidth = PACMAN.width;
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos, PACMAN.yPos, PACMAN.radius, 2 / 3 * Math.PI, Math.PI / 3);
    canvasContext.lineTo(PACMAN.xPos, PACMAN.yPos);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    canvasContext.fillStyle = "yellow";
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos + 5, PACMAN.yPos - 2, 1, 0, 2 * Math.PI);
    canvasContext.closePath();
    canvasContext.fill();
}
function drawPacManDownClose() {
    canvasContext.fillStyle = PACMAN.fill;
    canvasContext.strokeStyle = PACMAN.line;
    canvasContext.lineWidth = PACMAN.width;
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos, PACMAN.yPos, PACMAN.radius, 1 / 2 * Math.PI, 1 / 2 * Math.PI - 0.01);
    canvasContext.lineTo(PACMAN.xPos, PACMAN.yPos);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    canvasContext.fillStyle = "yellow";
    canvasContext.beginPath();
    canvasContext.arc(PACMAN.xPos + 5, PACMAN.yPos - 2, 1, 0, 2 * Math.PI);
    canvasContext.closePath();
    canvasContext.fill();
}
var score = 0;

LEFTTP = {
    x: 1,
    y: 220,
    xOut: 475,
    yOut: 238,
}

RIGHTTP = {
    x: 499,
    y: 220,
    xOut: 15,
    yOut: 238,
}

NEXTLVLTP = {
    x: 150,
    y: 500,
    xOut: 30,
    yOut: 30,
}

function updatePacman() {
    PACMAN.xPos += PACMAN.xDirection;
    PACMAN.yPos += PACMAN.yDirection;

    for (var i = 0; i < walls.length; i++) {
        var RightStop = PACMAN.xPos + PACMAN.radius > walls[i].x;
        var LeftStop = PACMAN.xPos - PACMAN.radius < walls[i].x + walls[i].width;
        var TopStop = PACMAN.yPos + PACMAN.radius > walls[i].y;
        var BottomStop = PACMAN.yPos - PACMAN.radius < walls[i].y + walls[i].height;
        if (RightStop && LeftStop && TopStop && BottomStop) {
            PACMAN.xPos -= PACMAN.xDirection * 2.5;
            PACMAN.yPos -= PACMAN.yDirection * 2.5;
            PACMAN.xDirection = 0;
            PACMAN.yDirection = 0;
        }
    }

    for (var i = 0; i < points.length; i++) {
        var RightPoint = PACMAN.xPos + PACMAN.radius > points[i].x;
        var LeftPoint = PACMAN.xPos - PACMAN.radius < points[i].x + POINTSIZE;
        var TopPoint = PACMAN.yPos + PACMAN.radius > points[i].y;
        var BottomPoint = PACMAN.yPos - PACMAN.radius < points[i].y + POINTSIZE;
        if (RightPoint && LeftPoint && TopPoint && BottomPoint) {
            points[i].x = -10;
            score += 1;
        }
    }

    if (PACMAN.xPos - PACMAN.radius < LEFTTP.x) {
        PACMAN.xPos = LEFTTP.xOut;
        PACMAN.yPos = LEFTTP.yOut;
    }

    if (PACMAN.xPos + PACMAN.radius > RIGHTTP.x) {
        PACMAN.xPos = RIGHTTP.xOut;
        PACMAN.yPos = RIGHTTP.yOut;
    }

    if (PACMAN.yPos + PACMAN.radius > NEXTLVLTP.y) {
        PACMAN.xPos -= PACMAN.xDirection * 2.5;
        PACMAN.yPos -= PACMAN.yDirection * 2.5;
        PACMAN.xDirection = 0;
        PACMAN.yDirection = 0;
        alert("Next lvl coming soon!");
    }

    var BlueGhostStompedLeft = PACMAN.xPos + PACMAN.radius > GHOSTBLUE.xPos - GHOSTBLUE.radius + 3;
    var BlueGhostStompedRight = PACMAN.xPos - PACMAN.radius < GHOSTBLUE.xPos + GHOSTBLUE.radius - 3;
    var BlueGhostStompedTop = PACMAN.yPos + PACMAN.radius > GHOSTBLUE.yPos - GHOSTBLUE.radius + 3;
    var BlueGhostStompedBottom = PACMAN.yPos - PACMAN.radius < GHOSTBLUE.yPos + GHOSTBLUE.radius - 3;
    if (BlueGhostStompedLeft && BlueGhostStompedRight && BlueGhostStompedTop && BlueGhostStompedBottom) {
        gameover = true;
        PACMAN.xDirection = 0;
        PACMAN.yDirection = 0;
        GHOSTBLUE.xDirection = 0;
        GHOSTBLUE.yDirection = 0;
        GHOSTRED.xDirection = 0;
        GHOSTRED.yDirection = 0;
        GHOSTYELLOW.xDirection = 0;
        GHOSTYELLOW.yDirection = 0;
    }
    var RedGhostStompedLeft = PACMAN.xPos + PACMAN.radius > GHOSTRED.xPos - GHOSTRED.radius + 3;
    var RedGhostStompedRight = PACMAN.xPos - PACMAN.radius < GHOSTRED.xPos + GHOSTRED.radius - 3;
    var RedGhostStompedTop = PACMAN.yPos + PACMAN.radius > GHOSTRED.yPos - GHOSTRED.radius + 3;
    var RedGhostStompedBottom = PACMAN.yPos - PACMAN.radius < GHOSTRED.yPos + GHOSTRED.radius - 3;
    if (RedGhostStompedLeft && RedGhostStompedRight && RedGhostStompedTop && RedGhostStompedBottom) {
        gameover = true;
        PACMAN.xDirection = 0;
        PACMAN.yDirection = 0;
        GHOSTBLUE.xDirection = 0;
        GHOSTBLUE.yDirection = 0;
        GHOSTRED.xDirection = 0;
        GHOSTRED.yDirection = 0;
        GHOSTYELLOW.xDirection = 0;
        GHOSTYELLOW.yDirection = 0;
    }
    var YellowGhostStompedLeft = PACMAN.xPos + PACMAN.radius > GHOSTYELLOW.xPos - GHOSTYELLOW.radius + 3;
    var YellowGhostStompedRight = PACMAN.xPos - PACMAN.radius < GHOSTYELLOW.xPos + GHOSTYELLOW.radius - 3;
    var YellowGhostStompedTop = PACMAN.yPos + PACMAN.radius > GHOSTYELLOW.yPos - GHOSTYELLOW.radius + 3;
    var YellowGhostStompedBottom = PACMAN.yPos - PACMAN.radius < GHOSTYELLOW.yPos + GHOSTYELLOW.radius - 3;
    if (YellowGhostStompedLeft && YellowGhostStompedRight && YellowGhostStompedTop && YellowGhostStompedBottom) {
        gameover = true;
        PACMAN.xDirection = 0;
        PACMAN.yDirection = 0;
        GHOSTBLUE.xDirection = 0;
        GHOSTBLUE.yDirection = 0;
        GHOSTRED.xDirection = 0;
        GHOSTRED.yDirection = 0;
        GHOSTYELLOW.xDirection = 0;
        GHOSTYELLOW.yDirection = 0;
    }
}

function updateGhostblue() {
    GHOSTBLUE.xPos += GHOSTBLUE.xDirection;
    GHOSTBLUE.yPos += GHOSTBLUE.yDirection;

    if (GHOSTBLUE.xDirection > 0) {
        GHOSTBLUE.ghost.src = "./img/ghostrightblue.png"
    }
    if (GHOSTBLUE.xDirection < 0) {
        GHOSTBLUE.ghost.src = "./img/ghostleftblue.png"
    }
    {
        if (GHOSTBLUE.xPos === 380 && GHOSTBLUE.yPos === 459) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = -GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 380 && GHOSTBLUE.yPos === 358) {
            GHOSTBLUE.xDirection = -GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 329 && GHOSTBLUE.yPos === 358) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = -GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 329 && GHOSTBLUE.yPos === 187) {
            GHOSTBLUE.xDirection = -GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 168 && GHOSTBLUE.yPos === 187) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 168 && GHOSTBLUE.yPos === 239) {
            GHOSTBLUE.xDirection = -GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 109 && GHOSTBLUE.yPos === 239) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 109 && GHOSTBLUE.yPos === 347) {
            GHOSTBLUE.xDirection = -GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 27 && GHOSTBLUE.yPos === 347) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 27 && GHOSTBLUE.yPos === 397) {
            GHOSTBLUE.xDirection = GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 57 && GHOSTBLUE.yPos === 397) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 57 && GHOSTBLUE.yPos === 457) {
            GHOSTBLUE.xDirection = -GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 27 && GHOSTBLUE.yPos === 457) {
            GHOSTBLUE.yPos = 456
            GHOSTBLUE.xDirection = GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 118 && GHOSTBLUE.yPos === 456) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = -GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 118 && GHOSTBLUE.yPos === 417) {
            GHOSTBLUE.xDirection = GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 168 && GHOSTBLUE.yPos === 417) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 168 && GHOSTBLUE.yPos === 478) {
            GHOSTBLUE.xDirection = GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 325 && GHOSTBLUE.yPos === 478) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = -GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 325 && GHOSTBLUE.yPos === 418) {
            GHOSTBLUE.xDirection = GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 378 && GHOSTBLUE.yPos === 418) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = -GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 378 && GHOSTBLUE.yPos === 352) {
            GHOSTBLUE.xDirection = GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 466 && GHOSTBLUE.yPos === 352) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 466 && GHOSTBLUE.yPos === 352) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 466 && GHOSTBLUE.yPos === 397) {
            GHOSTBLUE.xDirection = -GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 436 && GHOSTBLUE.yPos === 397) {
            GHOSTBLUE.xDirection = 0;
            GHOSTBLUE.yDirection = GHOSTBLUE.movespeed;
        }
        if (GHOSTBLUE.xPos === 436 && GHOSTBLUE.yPos === 460) {
            GHOSTBLUE.xDirection = GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }
        if (GHOSTBLUE.xPos === 467 && GHOSTBLUE.yPos === 460) {
            GHOSTBLUE.yPos = GHOSTBLUE.yPos - 1;
            GHOSTBLUE.xDirection = -GHOSTBLUE.movespeed;
            GHOSTBLUE.yDirection = 0;
        }

    } //Ghost movement blue
    count++;
}
function updateGhostred() {
    GHOSTRED.xPos += GHOSTRED.xDirection;
    GHOSTRED.yPos += GHOSTRED.yDirection;

    if (GHOSTRED.xDirection > 0) {
        GHOSTRED.ghost.src = "./img/ghostrightred.png"
    }
    if (GHOSTRED.xDirection < 0) {
        GHOSTRED.ghost.src = "./img/ghostleftred.png"
    }

    {
        if (GHOSTRED.xPos === 277 && GHOSTRED.yPos === 28) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 277 && GHOSTRED.yPos === 77) {
            GHOSTRED.xDirection = -GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
        if (GHOSTRED.xPos === 107 && GHOSTRED.yPos === 77) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = -GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 107 && GHOSTRED.yPos === 28) {
            GHOSTRED.xDirection = -GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
        if (GHOSTRED.xPos === 28 && GHOSTRED.yPos === 28) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 28 && GHOSTRED.yPos === 130) {
            GHOSTRED.xDirection = GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
        if (GHOSTRED.xPos === 107 && GHOSTRED.yPos === 130) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 107 && GHOSTRED.yPos === 239) {
            GHOSTRED.xDirection = GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
        if (GHOSTRED.xPos === 166 && GHOSTRED.yPos === 239) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 166 && GHOSTRED.yPos === 295) {
            GHOSTRED.xDirection = GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
        if (GHOSTRED.xPos === 327 && GHOSTRED.yPos === 295) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = -GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 327 && GHOSTRED.yPos === 238) {
            GHOSTRED.xDirection = GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
        if (GHOSTRED.xPos === 387 && GHOSTRED.yPos === 238) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = -GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 387 && GHOSTRED.yPos === 130) {
            GHOSTRED.xDirection = GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
        if (GHOSTRED.xPos === 468 && GHOSTRED.yPos === 130) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = -GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 468 && GHOSTRED.yPos === 78) {
            GHOSTRED.xDirection = -GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
        if (GHOSTRED.xPos === 278 && GHOSTRED.yPos === 78) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 278 && GHOSTRED.yPos === 78) {
            GHOSTRED.xDirection = 0;
            GHOSTRED.yDirection = -GHOSTRED.movespeed;
        }
        if (GHOSTRED.xPos === 278 && GHOSTRED.yPos === 27) {
            GHOSTRED.xDirection = GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
        if (GHOSTRED.xPos === 469 && GHOSTRED.yPos === 27) {
            GHOSTRED.xPos = 467;
            GHOSTRED.yPos = 28;
            GHOSTRED.xDirection = -GHOSTRED.movespeed;
            GHOSTRED.yDirection = 0;
        }
    }// Ghost movement red
}

function updateGhostyellow() {
    GHOSTYELLOW.xPos += GHOSTYELLOW.xDirection;
    GHOSTYELLOW.yPos += GHOSTYELLOW.yDirection;

    if (GHOSTYELLOW.xDirection > 0) {
        GHOSTYELLOW.ghost.src = "./img/ghostrightyellow.png"
    }
    if (GHOSTYELLOW.xDirection < 0) {
        GHOSTYELLOW.ghost.src = "./img/ghostleftyellow.png"
    }

    {
        if (GHOSTYELLOW.xPos === 117 && GHOSTYELLOW.yPos === 457) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = -GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 117 && GHOSTYELLOW.yPos === 358) {
            GHOSTYELLOW.xDirection = GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 207 && GHOSTYELLOW.yPos === 418) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 207 && GHOSTYELLOW.yPos === 358) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 207 && GHOSTYELLOW.yPos === 417) {
            GHOSTYELLOW.xDirection = GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 287 && GHOSTYELLOW.yPos === 417) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = -GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 287 && GHOSTYELLOW.yPos === 358) {
            GHOSTYELLOW.xDirection = GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 326 && GHOSTYELLOW.yPos === 358) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = -GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 326 && GHOSTYELLOW.yPos === 238) {
            GHOSTYELLOW.xDirection = GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 387 && GHOSTYELLOW.yPos === 238) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = -GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 387 && GHOSTYELLOW.yPos === 28) {
            GHOSTYELLOW.xDirection = -GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 277 && GHOSTYELLOW.yPos === 28) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 277 && GHOSTYELLOW.yPos === 77) {
            GHOSTYELLOW.xDirection = -GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 217 && GHOSTYELLOW.yPos === 77) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = -GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 217 && GHOSTYELLOW.yPos === 28) {
            GHOSTYELLOW.xDirection = -GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 28 && GHOSTYELLOW.yPos === 28) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 28 && GHOSTYELLOW.yPos === 130) {
            GHOSTYELLOW.xDirection = GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 107 && GHOSTYELLOW.yPos === 130) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 107 && GHOSTYELLOW.yPos === 349) {
            GHOSTYELLOW.xDirection = -GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 28 && GHOSTYELLOW.yPos === 349) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 28 && GHOSTYELLOW.yPos === 397) {
            GHOSTYELLOW.xDirection = GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 57 && GHOSTYELLOW.yPos === 397) {
            GHOSTYELLOW.xDirection = 0;
            GHOSTYELLOW.yDirection = GHOSTYELLOW.movespeed;
        }
        if (GHOSTYELLOW.xPos === 57 && GHOSTYELLOW.yPos === 458) {
            GHOSTYELLOW.xDirection = -GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }
        if (GHOSTYELLOW.xPos === 28 && GHOSTYELLOW.yPos === 458) {
            GHOSTYELLOW.yPos = 457;
            GHOSTYELLOW.xDirection = GHOSTYELLOW.movespeed;
            GHOSTYELLOW.yDirection = 0;
        }


    }// Ghost yellow movement
}

function drawPacManRight() {
    if (count % 20 <= 10) {
        drawPacManRightOpen()
    }
    if (count % 20 > 10) {
        drawPacManRightClose()
    }
}
function drawPacManLeft() {
    if (count % 20 <= 10) {
        drawPacManLeftOpen()
    }
    if (count % 20 > 10) {
        drawPacManLeftClose()
    }
}
function drawPacManTop() {
    if (count % 20 <= 10) {
        drawPacManTopOpen()
    }
    if (count % 20 > 10) {
        drawPacManTopClose()
    }
}
function drawPacManDown() {
    if (count % 20 <= 10) {
        drawPacManDownOpen()
    }
    if (count % 20 > 10) {
        drawPacManDownClose()
    }
}
function drawScorerScreen() {
    canvasContext.clearRect(0, 0, GAME.width, GAME.height);
    drawBackground();
    canvasContext.fillStyle = "white";
    canvasContext.font = "16pt Inter";
    canvasContext.fillText("Score: " + score, 211, 250);

}

function drawWinnerScreen() {
    canvasContext.clearRect(0, 0, GAME.width, GAME.height);
    drawBackground();
    canvasContext.fillStyle = "white";
    canvasContext.font = "16pt Inter";
    canvasContext.fillText("Victory!", 215, 250);

}

function initEventsListeners() {
    window.addEventListener("keydown", onCanvasKeyDown);
}

 
function onCanvasKeyDown() {
    if (event.key === "ArrowRight") {
        PACMAN.xDirection = PACMAN.direction;
        PACMAN.yDirection = 0;
        PacmanPos = "right";
    }

    if (event.key === "ArrowLeft") {
        PACMAN.xDirection = -PACMAN.direction;
        PACMAN.yDirection = 0;
        PacmanPos = "left";
    }

    if (event.key === "ArrowUp") {
        PACMAN.xDirection = 0;
        PACMAN.yDirection = -PACMAN.direction;
        PacmanPos = "up";
    }

    if (event.key === "ArrowDown") {
        PACMAN.xDirection = 0;
        PACMAN.yDirection = PACMAN.direction;
        PacmanPos = "down";
    }

}



function drawFrame() {
    canvasContext.clearRect(0, 0, GAME.width, GAME.height);
    drawBackground();

    if (gameover) {
        canvasContext.clearRect(0, 0, GAME.width, GAME.height);
        drawBackground();
        drawMenu();
    } else {
        if (score === points.length) {
            drawWinnerScreen();
        }
        if (score != points.length) {
            drawScorerScreen();
            drawPoints();
            drawGhostBlue();
            drawGhostRed();
            drawGhostYellow();
            updateGhostblue();
            updateGhostred();
            updateGhostyellow();
        }

        if (PacmanPos === "right")
            drawPacManRight();
        if (PacmanPos === "left")
            drawPacManLeft();
        if (PacmanPos === "down")
            drawPacManDown();
        if (PacmanPos === "up")
            drawPacManTop();

        updatePacman();
    }

}

function play() {
    drawFrame();
    requestAnimationFrame(play);

}

initEventsListeners();
play();
