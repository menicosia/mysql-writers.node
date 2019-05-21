// Mysql Writers - an app to send transactions to a MySQL database,
//    and record how long they take to commit.

var finalhandler = require('finalhandler') ;
var http = require('http') ;
var serveStatic = require('serve-static') ;
var strftime = require('strftime') ;
var time = require('time') ;
var url = require('url') ;
var mysql = require('mysql') ;
var redis = require('redis') ;
var util = require('util') ;

// CONFIGURE THESE
// var numSecondsStore = 600 // Default 10 minutes

// Variables
var data = "" ;
var myIndex = 0 ;
var port = 8080 ;
var activateState = Boolean(false) ;
var localMode = Boolean(false) ;
var pm_uri = undefined ;
var vcap_services = undefined ;
var pm_credentials = undefined ;
var dbClient = undefined ;
var reportTimer = undefined ;
var dbConnectState = Boolean(false) ;
var numTxns = 0 ;
var lastTxnCount = 0 ;
var lastTxnSuccess = 0 ;

// REDIS DOCUMENTATION

// Each instance is responsible for recording its own activity in
// Redis. Because this is loud foundry, there's only ever expected to
// be one of each index running ie there should be no conflicts of
// multiple instances updating the same data.
//
// Mysql Writers records two pieces of information in Redis:
// Instance_X_Hash{lastTxnCount} - number of txns completed in the last sec
// Instance_X_Hash{lastTxnSuccess} - time of last successful transaction
// Future improvement:
// Instance_X_List - A 600-int list to represent # of txns 10-min history

var redis_credentials = undefined ;
var redis_host = undefined ;
var redisClient = undefined ;
var redisConnectionState = Boolean(false) ;

// Setup based on Environment Variables
if (process.env.VCAP_SERVICES) {
    vcap_services = JSON.parse(process.env.VCAP_SERVICES) ;
    if (vcap_services['p-mysql']) {
        pm_uri = vcap_services["p-mysql"][0]["credentials"]["uri"] ;
        console.log("Got access p-mysql credentials: " + pm_uri) ;
        activateState=true ;
    } else if (vcap_services['dedicated-pivotal-mysql']) {
        pm_uri = vcap_services["dedicated-pivotal-mysql"][0]["credentials"]["uri"] ;
        console.log("Got access dedicated-pivotal-mysql credentials: " + pm_uri) ;
        activateState=true ;
    } else if (vcap_services['cleardb']) {
        pm_uri = vcap_services["cleardb"][0]["credentials"]["uri"];
        console.log("Got access to cleardb credentials: " + pm_uri) ;
        activateState=true;
    } else {
        console.log("No VCAP_SERVICES mysql bindings. Will attempt to connect via 'MYSQL_URI'")
    }
    if (vcap_services['redis']) {
        redis_credentials = vcap_services["redis"][0]["credentials"] ;
        console.log("Got access credentials to redis: " + redis_credentials["host"]
                 + ":" + redis_credentials["port"]) ;
    } else if (vcap_services['rediscloud']) {
        redis_credentials = vcap_services["rediscloud"][0]["credentials"] ;
        console.log("Got access credentials to redis: " + redis_credentials["hostname"]
                 + ":" + redis_credentials["port"]) ;
    } else if (vcap_services['p-redis']) {
        redis_credentials = vcap_services["p-redis"][0]["credentials"] ;
        console.log("Got access credentials to p-redis: " + redis_credentials["host"]
                 + ":" + redis_credentials["port"]) ;
    } else {
        console.log("No VCAP_SERVICES redis bindings. Will attempt to connect via 'REDIS_CREDS'")
    }
}

if (process.env.VCAP_APP_PORT) { port = process.env.VCAP_APP_PORT ;}

if (process.env.CF_INSTANCE_INDEX) { myIndex = JSON.parse(process.env.CF_INSTANCE_INDEX) ; }
else {
    console.log("CF not detected, attempting to run in local mode.") ;
    localMode = true ;
    if (process.env.MYSQL_URI) {
        pm_uri = process.env.MYSQL_URI ;
    } else {
        pm_uri = "mysql://root@localhost:3306/default?reconnect=true" ;
    }
    activateState = true ;
    if (process.env.REDIS_CREDS) {
        creds = process.env.REDIS_CREDS.split(":") ;
        if (3 != creds.length) {
            console.error("[ERROR] REDIS_CREDS environment variable must be colon separated host:port:password") ;
            process.exit(1) ;
        } else {
            redis_credentials = { 'password' : creds[2], 'host' : creds[0], 'port' : creds[1] } ;
        }
    } else {
        redis_credentials = { 'password' : '', 'host' : '127.0.0.1', 'port' : '6379' } ;
    }
    console.log("MySQL URI: " + pm_uri) ;
    myIndex = 0 ;
}

// Here lie the names of the Redis data structures that we'll read/write from
var myInstance = "Instance_" + myIndex + "_Hash" ;
// var myInstanceBits = "Instance_" + myIndex + "_Bits" ;
var myInstanceList = "Instance_" + myIndex + "_List" ;

// Setup and Auto-configuration

var myDataTable = "SampleData_" + myIndex ;

// Validate or set up the schema if necessary. Add any callback to
// star the main loop after the schema is available.
function setupSchema(mainloop) {
    dbClient.query("show tables LIKE '" + myDataTable + "'", function(err, results, fields) {
        if (err) {
            console.error("Failed to query for existing schema: " + err) ;
            process.exit(1) ;
        } else {
            if (0 == results.length) {
                console.log("Setting up schema.") ;
                dbClient.query("create table " + myDataTable + " (ts TIMESTAMP, v VARCHAR(2))",
                               function (err, results, fields) {
                                   if (err) {
                                       console.error("Unable to create database: %s", err)
                                   } else {
                                       console.log("Schema created.") ;
                                       mainloop() ;
                                   }
                               })
            } else {
                console.log("verfied that data table exists.") ;
                mainloop() ;
            }
        }
    }) ;
}

// Entry point to both start writing txn rate to redis, and start writing transactions

function mainloop() {
    reportTimer = setInterval(recordTransactions, 1000) ;
    doTransaction() ;
}

// Callback functions

function handleDBerror(err) {
    if (err) {
        console.warn("Issue with database, %s. Attempting to reconnect every 1 second.",
                     err.code) ;
        if (reportTimer) { reportTimer.clearInterval() }
        if (activateState) { setTimeout(MySQLConnect, 1000) ; }
        else {
            console.error("[INTERNAL ERROR] Disconnected from database and acive=false?")
            process.exit(1) ;
        }
    }
}

function handleDBConnect(err) {
    if (err) {
        console.error("Error connecting to DB: "
                  + err.code + "\nWill try again in 1s.") ;
        if (activateState == true) { setTimeout(MySQLConnect, 1000) ; }
        dbConnectState = false ;
    } else {
        console.log("connected to database.") ;
        dbClient.on('error', handleDBerror) ;
        dbConnectState = true ;
        setupSchema(mainloop) ;
    }
}

function handleRedisConnect(message, err) {
    switch (message) {
    case "error":
        redisConnectionState = false ;
        console.warn("Redis connection failed: " + err + "\nWill try again in 3s." ) ;
        setTimeout(RedisConnect, 3000) ;
        break ;
    case "ready":
        redisConnectionState = true ;
        console.log("Redis READY.") ;
        break ;
    default:
        console.warn("Redis connection result neither error nor ready?!") ;
        break ;
    }
}

// Helper functions
function recordTransactionsHelper(err, res) {
    if (err) {
        console.error("Error from redis: " + err) ;
    } else {
        redisClient.hmset(myInstance, "numTxnsLastSec", numTxns-lastTxnCount) ;
        redisClient.hmset(myInstance, "lastTxnSuccess", lastTxnSuccess) ;
        lastTxnCount = numTxns ;
    }
}

function recordTransactions() {
    console.log("Recording # of txns in Redis. Current: %d, Last was: %d",
                numTxns, lastTxnCount) ;
    if (redisConnectionState) {
        redisClient.hget(myInstance, "numTxns", function(err, res) {
            recordTransactionsHelper(err, res) ;
        }) ;
    }
}

function handleWriteRequest(error, results, fields) {
    if (error) {
        console.error("[ERROR] Failed writing to DB: %s", error) ;
        process.exit(50) ;
    } else {
        numTxns++ ;
        lastTxnSuccess = time.time() ;
        // Why call doTransaction() from handleWriteRequest, rather
        // than an infinite loop in doTransaction itself?  Because I
        // believe this is a better way of serializing; I don't want
        // doTransaction to spew transactions without backpressure. I
        // want it to issue one transaction at a time.
        writerTimeout = setTimeout(doTransaction, 100) ; // Hopefully this doesn't build lots of entries in the stack?
    }
}

function doTransaction() {
    if (activateState && dbConnectState) {
        var sql = "insert into " + myDataTable + " VALUES (NOW(), NULL)" ;
        dbClient.query(sql, function (error, results, fields) {
            handleWriteRequest(error, results, fields) ;
        }) ;
    } else {
        console.log("[WARNING] Cannot write, DB not ready.")
    }
}

function MySQLConnect() {
    if (activateState) {
        dbClient = mysql.createConnection(pm_uri)
        dbClient.connect(handleDBConnect) ;
        dbClient.on('error', handleDBConnect) ;
    } else {
        console.error("[INTERNAL ERROR] MySQLConnect called, but activate-state is false") ;
        dbClient = undefined ;
    }
}

function RedisConnect() {
    if (activateState && redis_credentials) {
        console.log("Attempting to connect to redis...") ;
        if (redis_credentials["host"]) {
          redisClient = redis.createClient(redis_credentials["port"], redis_credentials["host"]) ;
        } else {
          redisClient = redis.createClient(redis_credentials["port"], redis_credentials["hostname"]) ;
        }
        if (! localMode) { redisClient.auth(redis_credentials["password"]) ; }
        redisClient.on("error", function(err) { handleRedisConnect("error", err) }) ;
        redisClient.on("ready", function(err) { handleRedisConnect("ready", undefined) }) ;
    } else {
        redisClient = undefined ;
        redisConnectionState = false ;
    }
}

function handleBits(request, response, reply) {
    // console.log("Returning array from Redis of length: " + reply.length) ;
    response.end(JSON.stringify(reply)) ;
    return(true) ;
}

function instanceInfo(req, res, instance) {
    if (redisConnectionState) {
        redisClient.hgetall(instance, function (err, reply) {
            if (err) {
                console.error("[ERROR] querying redis for instance info: " + err) ;
                process.exit(5) ;
            } else {
                handleBits(req, res, reply) ;
            }
        } ) ;
    } else {
        err = "[ERROR] got request for instance info, redis not ready." ;
        console.error(err) ;
        res.end(err) ;
    }
}

function dispatchApi(request, response, method, query) {
    switch(method) {
    case "instanceInfo":
        desired_instance = "Instance_" + Object.keys(query)[0] + "_Hash" ;
        console.log("[dispatchApi] instanceInfo on: " + desired_instance) ;
        instanceInfo(request, response, desired_instance) ;
        break ;
    }
}

function requestHandler(request, response) {
    data = "" ;
    requestParts = url.parse(request.url, true);
    rootCall = requestParts['pathname'].split('/')[1] ;
    console.log("Recieved request for: " + rootCall) ;
    switch (rootCall) {
    case "env":
	      if (process.env) {
	          data += "<p>" ;
		        for (v in process.env) {
		            data += v + "=" + process.env[v] + "<br>\n" ;
		        }
		        data += "<br>\n" ;
	      } else {
		        data += "<p> No process env? <br>\n" ;
	      }
        response.write(data) ;
	      break ;
    case "json":
        var method = requestParts['pathname'].split('/')[2] ;
        dispatchApi(request, response, method, requestParts['query']) ;
        return true ; // short-circuit response.end below.
        break ;
    case "dbstatus":
        data += JSON.stringify({"dbStatus":dbConnectState}) ;
        response.write(data) ;
        break ;
    case "debug":
        // This is the old code that was the original index page.
        data += "<h1>MySQL Wwriter</h1>\n" ;
        data += "<p>" + strftime("%Y-%m-%d %H:%M") + "<br>\n" ;
        data += "<p>Request was: " + request.url + "<br>\n" ;
        if (activateState) {
	          data += "Database connection info: " + pm_uri + "<br>\n" ;
        } else {
            data += "Database info is NOT SET</br>\n" ;
        }
        data += "</p\n<hr>\n" ;
        data += "<A HREF=\"" + url.resolve(request.url, "env") + "\">/env</A>  " ;
        response.write(data) ;
        break ;
    default:
        console.log("Unknown request: " + request.url) ;
        response.statusCode = 404 ;
        response.statusMessage = http.STATUS_CODES[404] ;
        response.writeHead(404) ;
        response.write("<H1>404 - Not Found</H1>") ;
    }

    response.end() ;
}

// MAIN
    
if (activateState) {
    MySQLConnect() ;
    RedisConnect() ;
} else {
    console.error("[ERROR] Insufficient configuration to connect to data services.") ;
    process.exit(100) ;
}

var staticServer = serveStatic("static") ;
monitorServer = http.createServer(function(req, res) {
var done = finalhandler(req, res) ;
    staticServer(req, res, function() { requestHandler(req, res, done) ; } ) ;
}) ;


monitorServer.listen(port) ;
console.log("Server up and listening on port: " + port) ;
