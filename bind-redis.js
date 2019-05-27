module.exports.getRedisCreds = function() {
    var redis_creds = {} ;
    if ("VCAP_SERVICES" in process.env) {
        var vcap_services = JSON.parse(process.env.VCAP_SERVICES) ;
        if ("p-redis" in vcap_services) {
            service = 'p-redis' ;
        } else if ("p.redis" in vcap_services) {
            service = "p.redis" ;
        } else if ("rediscloud" in vcap_services) {
            service = "rediscloud" ;
        } else {
            console.log("VCAP_SERVICES defined, but no Redis binding found.") ;
            return(undefined) ;
        }
    } else {
        console.log("No VCAP_SERVICES in environment; using localhost") ;
        redis_creds["host"] = "localhost" ;
        redis_creds["password"] = "password" ;
        redis_creds["port"] = "port" ;
        return(redis_creds) ;
    }

    creds_array = vcap_services[service][0]["credentials"] ;
    if ("rediscloud" == service) {
        redis_creds["host"] = creds_array["hostname"] ;
    } else {
        redis_creds["host"] = creds_array["host"] ;
    }
    redis_creds["password"] = creds_array["password"] ;
    redis_creds["port"] = creds_array["port"] ;
    console.log("Got access credentials to " + service) ;
    return(redis_creds) ;
}
