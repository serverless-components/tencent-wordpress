<?php
error_reporting(0);
// A special handler.

// All requests through API Gateway are HTTPS.
$_SERVER['HTTPS'] = 'on';

function active_mysql_connect()
{
    $connect_db_retry_num = 0;
    $conn = new mysqli();
    // 尝试最多200次连接，每次间隔100ms，这里仅针对db处于暂定状态下重试，其他情况有wordpress本身去处理。
    while ($connect_db_retry_num <= 200) {
        $conn->connect(getenv("DB_HOST"), getenv("DB_USER"), getenv("DB_PASSWORD"));
        if ($conn->connect_error == "CynosDB serverless instance is resuming, please try connecting again") {
            $connect_db_retry_num += 1;
            usleep(100000);
            continue;
        } else {
            break;
        }
    }
    return $connect_db_retry_num;
}

// 尝试去激活serverless db
$db_mode = "";
$db_mode = getenv("DB_MODE");
if ($db_mode == "SERVERLESS") {
  active_mysql_connect();
}


$extension_map = array(
    "css" => "text/css",
    "js" => "application/javascript",
    "png" => "image/png",
    "jpeg" => "image/jpeg",
    "jpg" => "application/x-jpg",
    "svg" => "image/svg+xml",
    "gif" => "image/gif",
    "pdf" => "application/pdf",
    "mp4" => "video/mpeg4",
    "bmp" => "application/x-bmp",
    "c4t" => "application/x-c4t",
    "img" => "application/x-img",
    "m2v" => "video/x-mpeg",
    "mp2v" => "video/mpeg",
    "mpeg" => "video/mpg",
    "ppt" => "application/x-ppt",
    "rm" => "application/vnd.rn-realmedia",
    "swf" => "video/mpeg4",
    "tif" => "image/tiff",
    "tiff" => "image/tiff",
    "vcf" => "text/x-vcard",
    "wav" => "audio/wav",
    "wma" => "audio/x-ms-wma",
    "wmv" => "video/x-ms-wmv",
    "apk" => "application/vnd.android.package-archive",
    "m1v" => "video/x-mpeg",
    "m3u" => "audio/mpegurl",
    "mp2" => "audio/mp2",
    "mp3" => "audio/mp3",
    "mpa" => "video/x-mpg",
    "mpe" => "video/x-mpeg",
    "mpg" => "video/mpg",
    "mpv2" => "video/mpeg",
    "rmvb" => "application/vnd.rn-realmedia-vbr",
    "torrent" => "application/x-bittorrent",
);


$request_uri = explode("?", $_SERVER['REQUEST_URI']);
$local_file_path = $_SERVER['DOCUMENT_ROOT'] . urldecode($request_uri[0]);


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

