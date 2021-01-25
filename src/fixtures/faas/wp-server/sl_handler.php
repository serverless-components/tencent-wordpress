<?php
/**
 * Notes: 封装PHPCurl请求
 * Author: alanoluo
 * Email: alanoluo@tencent.com
 * Date: 2021/1/17 10:58
 */


error_reporting(E_ALL | E_STRICT);

$SCF_RUNTIME_API = getenv('SCF_RUNTIME_API') . (":" . getenv('SCF_RUNTIME_API_PORT'));


/**
 * Notes: 启动一个子进程
 * Author: tencent
 * Date: 2019/7/23 10:58
 */
function start_webserver()
{
    $SERVER_STARTUP_TIMEOUT = 1000000; // 1 second
    $handler_filename = getenv('HANDLER');
    $mount_dir = getenv('MOUNT_DIR');
    $pid = pcntl_fork();
  switch($pid) {
    case -1:
      die("Failed to fork webserver process\n");

    case 0:
      // exec the command
      chdir($mount_dir);
      exec("PHP_INI_SCAN_DIR=/opt/etc/php.d/ php -S localhost:8000 -d extension_dir=/opt/lib/php/modules/ $handler_filename >/tmp/null &");
      exit;

    default:
      // Wait for child server to start
      $start = microtime(true);

      do {
        if (microtime(true) - $start > $SERVER_STARTUP_TIMEOUT) {
          die("Webserver failed to start within one second\n");
        }

        usleep(1000);
        $fp = @fsockopen('localhost', 8000, $errno, $errstr, 1);
      } while ($fp == false);

      fclose($fp);
  }
}

/**
 * Notes: 封装PHPCurl请求
 * Author: tencent
 * Date: 2019/7/23 10:58
 * @param $url
 * @param null $data
 * @param string $method
 * @param string $header
 * @return bool|mixed|string
 */
function network_request($url, $method = 'get', $header = '', $data = null)
{

    $ch = curl_init();//初始化
    $response = array('body' => '');
    curl_setopt($ch, CURLOPT_URL, $url);//访问的URL
    //只获取页面内容，但不输出
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
    //返回response头部信息
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method)); //设置请求方式
    if (!empty($header)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $header); //模拟的header头
    }
    if ($data && strlen($data) > 0) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
    }

    curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($ch, $header) use (&$response) {

        if (preg_match('/HTTP\/1.1 (\d+) .*/', $header, $matches)) {
            $response['statusCode'] = intval($matches[1]);
            return strlen($header);
        }

        if (!preg_match('/:\s*/', $header)) {
            return strlen($header);
        }

        [$name, $value] = preg_split('/:\s*/', $header, 2);

        $name = trim($name);
        $value = trim($value);

        if ($name == '') {
            return strlen($header);
        }
        if (!array_key_exists('headers', $response)) {
            $response['headers'] = array();
        }

        if (!array_key_exists($name, $response['headers'])) {
            $response['headers'][$name] = $value;
        } else {
            if (!is_array($response['headers'][$name])) {
                $response['headers'][$name] = array($response['headers'][$name]);
            }
            array_push($response['headers'][$name], $value);
        }

        return strlen($header);
    });

    curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $chunk) use (&$response) {
        $response['body'] .= $chunk;

        return strlen($chunk);
    });
    curl_exec($ch);
    curl_close($ch);//关闭curl，释放资源
    return $response;
}

/**
 * Notes: 激活serverless db，serverless db长时间未连接会处于暂停状态，参考https://cloud.tencent.com/document/product/1003/50853
 * @return int
 */
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

// 启动服务
start_webserver();

// 初试化完成之后需要请求SCF，上报初始化完成状态
network_request("http://$SCF_RUNTIME_API/runtime/init/ready", "post", '', " ");

while (true) {
    // 获取scf的入参
    $event = network_request("http://$SCF_RUNTIME_API/runtime/invocation/next", "get", '');

    // 尝试去激活serverless db，但这不建议作为一个主流程步骤，因为
    active_mysql_connect();

    // 解析apigw传回来的入参
    $request_json = json_decode($event['body'], true);

    // 解析uri
    $uri = $request_json['path'];

    if (array_key_exists('queryString', $request_json) && $request_json['queryString']) {
        $first = true;
        foreach ($request_json['queryString'] as $name => $value) {
            if ($first) {
                $uri .= "?";
                $first = false;
            } else {
                $uri .= "&";
            }
            //需要对name和value进行url编码，否则不支持中文
            $uri .= urlencode($name);

            if ($value != '') {
                $uri .= '=' . urlencode($value);
            }
        }
    }

    // 解析header
    $headers = array();
    if (array_key_exists('headers', $request_json)) {
        foreach ($request_json['headers'] as $name => $values) {
            if (is_array($values)) {
                foreach ($values as $value) {
                    array_push($headers, "${name}: ${value}");
                }
            } else {
                array_push($headers, "${name}: ${values}");
            }
        }
    }

    // 解析body
    $body = null;
    if (array_key_exists('body', $request_json)) {
        $body = $request_json['body'];
        if (array_key_exists('isBase64Encoded', $request_json) && $request_json['isBase64Encoded']) {
            $body = base64_decode($body);
        }
    }

    $data = network_request("http://localhost:8000$uri", $request_json['httpMethod'], $headers, $body);
    $data["body"] = base64_encode($data["body"]);
    $data["isBase64Encoded"] = true;
    network_request("http://$SCF_RUNTIME_API/runtime/invocation/response", "post", '', json_encode($data));
}
?>
