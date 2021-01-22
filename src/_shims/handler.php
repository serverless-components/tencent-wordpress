<?php

// A special handler.

// All requests through API Gateway are HTTPS.
$_SERVER['HTTPS'] = 'on';

$extension_map = array(
    "css" => "text/css",
    "js" => "application/javascript",
    "png" => "image/png",
    "jpeg" => "image/jpeg",
    "jpg" => "image/jpeg",
    "svg" => "image/svg+xml"
);

$request_uri = explode("?", $_SERVER['REQUEST_URI']);
$local_file_path = $_SERVER['DOCUMENT_ROOT'] . $request_uri[0];

if ( $local_file_path == __FILE__ ) {
    http_response_code(400);
    echo 'Sorry';
    exit();
}

$split = explode(".", $local_file_path);
$extension = end($split);
$mapped_type = $extension_map[$extension];

if ( $mapped_type && file_exists( $local_file_path ) ) {
    header("Content-Type: {$mapped_type}");
    $file_size=filesize($local_file_path);
    header("Accept-Length:$file_size");
    $fp=fopen($local_file_path,"r");
    $buffer=1024;
    $file_count=0;
    while(!feof($fp)&&($file_size-$file_count>0)){
        $file_data=fread($fp,$buffer);
        //统计读了多少个字节
        $file_count+=$buffer;
        echo $file_data;
    }
    fclose($fp);
} elseif ( $extension == "php" && file_exists( $local_file_path ) ) {
    header("X-ExecFile: {$local_file_path}");
    require( $local_file_path );

} elseif ( substr($local_file_path, -1) == "/" && file_exists( $local_file_path . "index.php" ) ) {
    $exec_file_path = $local_file_path . "index.php";
    header("X-ExecFile: {$exec_file_path}");
    require( $exec_file_path );

} else {
    $exec_file_path = dirname(__FILE__) . '/index.php';
    header("X-ExecFile: {$exec_file_path}");
    require( $exec_file_path );
}

