// Mysql Writers - an app to send transactions to a MySQL database,
//    and record how long they take to commit.

"use strict" ;

var requestParts = undefined ;
var finalhandler = require('finalhandler') ;
var http = require('http') ;
var serveStatic = require('serve-static') ;
var strftime = require('strftime') ;
var time = require('time') ;
var url = require('url') ;
var bindMySQL = require('./bind-mysql.js') ;
var bindRedis = require('./bind-redis.js') ;
var mysql = require('mysql') ;
var redis = require('redis') ;
var util = require('util') ;

// CONFIGURE THESE
// var numSecondsStore = 600 // Default 10 minutes

// Variables
var myIndex = 0 ;
var port = 8080 ;
var activateState = Boolean(false) ;
var readOnly = Boolean(false) ;
var writerTimeout = undefined ; 
var mysql_creds = undefined ;
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

var redis_creds = undefined ;
var redisClient = undefined ;
var redisConnectionState = Boolean(false) ;

// Setup based on Environment Variables
if ("VCAP_SERVICES" in process.env) {
}

if (process.env.VCAP_APP_PORT) { var port = process.env.VCAP_APP_PORT ;}
else { var port = 8080 ; }
mysql_creds = bindMySQL.getMySQLCreds() ;
redis_creds = bindRedis.getRedisCreds() ;
if (mysql_creds && redis_creds) {
    activateState = Boolean(true) ;
}

if (process.env.CF_INSTANCE_INDEX) { myIndex = JSON.parse(process.env.CF_INSTANCE_INDEX) ; }

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
    } else {
        numTxns++ ;
        lastTxnSuccess = time.time() ;
    }
    // Why call doTransaction() from handleWriteRequest, rather
    // than an infinite loop in doTransaction itself?  Because I
    // believe this is a better way of serializing; I don't want
    // doTransaction to spew transactions without backpressure. I
    // want it to issue one transaction at a time.
    writerTimeout = setTimeout(doTransaction, 100) ; // Hopefully this doesn't build lots of entries in the stack?
}

function doTransaction() {
    if (! readOnly) {
        if (activateState && dbConnectState) {
            var sql = "insert into " + myDataTable + " VALUES (NOW(), NULL)" ;
            dbClient.query(sql, function (error, results, fields) {
                handleWriteRequest(error, results, fields) ;
            }) ;
        } else {
            console.log("[WARNING] doTransaction - activate state false. Retrying in 1s.")
            writerTimeout = setTimeout(doTransaction, 1000) ;
        }
    }
}

function MySQLConnect(response) {
    if (activateState && mysql_creds) {
        console.log("Connecting to MySQL: " + mysql_creds["host"]) ;
        var clientConfig = {
            host : mysql_creds["host"],
            user : mysql_creds["user"],
            password : mysql_creds["password"],
            port : mysql_creds["port"],
            database : mysql_creds["database"]
        } ;
        if (mysql_creds["ca_certificate"]) {
            console.log("CA Cert detected; using TLS");
            clientConfig["ssl"] = { ca : mysql_creds["ca_certificate"] } ;
        }
        dbClient = mysql.createConnection( clientConfig ) ;
        dbClient.connect(function (err, results, fields) {
            handleDBConnect(err, response)
        }) ;
        dbClient.on('error', handleDBConnect) ;
    } else {
        console.error("[WARN] MySQLConnect - activate state is false") ;
        dbClient = undefined ;
    }
}

function RedisConnect() {
    if (activateState && redis_creds) {
        console.log("Connecting to Redis: " + redis_creds["host"]) ;
        redisClient = redis.createClient(redis_creds["port"],
                                         redis_creds["host"]) ;
        redisClient.auth(redis_creds["password"]) ;
        redisClient.on("error", function(err) { handleRedisConnect("error", err) }) ;
        redisClient.on("ready", function(err) { handleRedisConnect("ready", undefined) }) ;
    } else {
        console.log("[WARN] RedisConnect - activate state is false.") ;
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
        var err = "[ERROR] got request for instance info, redis not ready." ;
        console.error(err) ;
        res.end(err) ;
    }
}

function handleReplicationTS(error, results, fields, response) {
    if (error) {
        console.error("[ERROR] failed to read replication status") ;
    } else {
        console.log("Got replication status: " + JSON.stringify(results[0])) ;
        response.end(JSON.stringify(results[0])) ;
    }
}

function followerStatus(response) {
    if (activateState && dbConnectState) {
        var sql = "select ts from replication_monitoring.heartbeat LIMIT 1" ;
        dbClient.query(sql, function(error, results, fields) {
            handleReplicationTS(error, results, fields, response) ;
        }) ;
    } else {
        str = "[followerStatus] Sorry cannot complete request." ;
        console.log(str) ;
        response.end(JSON.stringify(str)) ;
    }
}

function dispatchApi(request, response, method, query) {
    switch(method) {
    case "instanceInfo":
        var desired_instance = "Instance_" + Object.keys(query)[0] + "_Hash";
        console.log("[dispatchApi] instanceInfo on: " + desired_instance) ;
        instanceInfo(request, response, desired_instance) ;
        break ;
    case "followerStatus":
        console.log("[dispatchApi] followerStatus") ;
        followerStatus(response) ;
        break ;
    }
}

function requestHandler(request, response) {
    var data = "" ;
    var requestParts = url.parse(request.url, true);
    var rootCall = requestParts['pathname'].split('/')[1] ;
    console.log("Recieved request for: " + rootCall) ;
    switch (rootCall) {
    case "env":
        var v ;
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
        data += "</p\n<hr>\n" ;
        data += "<A HREF=\"" + url.resolve(request.url, "env") + "\">/env</A>  " ;
        response.write(data) ;
        break ;
    case "useDB":
        if ("query" in requestParts
            && "host" in requestParts["query"] && "db" in requestParts["query"]
            && "user" in requestParts["query"] && "pw" in requestParts["query"]) {
            console.log("Received DB connection info: " + requestParts["query"]["host"]) ;
            mysql_creds["host"] = requestParts["query"]["host"] ;
            mysql_creds["database"] = requestParts["query"]["db"] ;
            mysql_creds["user"] = requestParts["query"]["user"] ;
            mysql_creds["password"] = requestParts["query"]["pw"] ;
            // mysql_creds["port"] = 3306 ;
            if ("writeDB" in requestParts["query"]) {
                console.debug("Value of checkbox writeDB is: "
                              + mysql_creds["writeDB"]) ;
                readOnly = Boolean(false) ;
            } else {
                console.log("Choosing read only mode.") ;
                readOnly = Boolean(true) ;
            }
            activateState = Boolean(true) ;
            MySQLConnect(response) ;
        } else {
            response.end("ERROR: Usage: /useDB?host=foo&db=bar&user=baz&pw=garply "
                         + "(request: " + request.url  + ")\n") ;
        }
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
var monitorServer = http.createServer(function(req, res) {
var done = finalhandler(req, res) ;
    staticServer(req, res, function() { requestHandler(req, res, done) ; } ) ;
}) ;


monitorServer.listen(port) ;
console.log("Server up and listening on port: " + port) ;
