module.exports.getMySQLCreds = function() {
    var mysql_creds = {} ;
    if (process.env.VCAP_SERVICES) {
        var vcap_services = JSON.parse(process.env.VCAP_SERVICES) ;
        if (vcap_services['p.mysql']) {
            service = "p.mysql" ;
        } else if (vcap_services['p-mysql']) {
            service = "p-mysql" ;
        } else {
            console.log("VCAP_SERVICES defined, but no MySQL binding found.") ;
            return(undefined) ;
        }
    } else {
        console.log("No VCAP_SERVICES in environment; using localhost") ;
        service = "local" ;
        mysql_creds["host"] = "localhost" ;
        mysql_creds["user"] = "root" ;
        mysql_creds["password"] = "password" ;
        mysql_creds["database"] = "service_instance_db" ;
        mysql_creds["ca_certificate"] = undefined ;
        return(mysql_creds) ;
    }
    creds_array = vcap_services[service][0]["credentials"] ;
    
    mysql_creds["host"] = creds_array["hostname"] ;
    mysql_creds["user"] = creds_array["username"] ;
    mysql_creds["password"] = creds_array["password"] ;
    mysql_creds["port"] = creds_array["port"] ;
    mysql_creds["database"] = creds_array["name"] ;
    if ("tls" in creds_array) {
        mysql_creds["ca_certificate"] = creds_array["tls"]["cert"]["ca"];
    } else {
        mysql_creds["ca_certificate"] = undefined ;
    }
    mysql_creds["uri"] = creds_array["uri"] ;
    console.log("Got access credentials to " + service) ;
    return(mysql_creds) ;
}
