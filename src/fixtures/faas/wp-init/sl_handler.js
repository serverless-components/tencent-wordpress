const fs = require('fs')
const COS = require('cos-nodejs-sdk-v5')
const mysql = require('mysql2/promise')
const { sleep, unzip, copyDir } = require('./utils')

async function handler(event, context) {
  context.callbackWaitsForEmptyEventLoop = false
  const generateId = () =>
    Math.random()
      .toString(36)
      .substring(6)
  const randomId = generateId()
  const contentPath = '/mnt/wp-content'
  const unzipPath = `/tmp/${randomId}/unzip`
  const contentCopyPath = `/tmp/${randomId}/unzip/wp-content`
  const downloadZipPath = `/tmp/${randomId}/wp.zip`
  const response = {
    status: 'failed',
    reason: '',
    mountDir: unzipPath,
    syncDbRetryNumber: 0
  }

  // 同步数据库
  async function syncDatabase() {
    try {
      const dbname = process.env.DB_NAME
      const db = await mysql.createConnection({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT
      })
      await db.query(`CREATE DATABASE IF NOT EXISTS ${dbname}`)
      console.log(`Initialize database ${dbname} success`)
      return true
    } catch (e) {
      console.log(`${e}`, e.message)
      if (
        e.message.indexOf(
          'CynosDB serverless instance is resuming, please try connecting again'
        ) !== -1
      ) {
        if (response.syncDbRetryNumber >= 10) {
          response.reason = `[Serverless DB Error]: ${e.message}`
          return false
        }
        await sleep(1000)
        response.syncDbRetryNumber++
        return syncDatabase()
      }
      response.reason = `[Serverless DB Error]: ${e.message}`
      return false
    }
  }

  const syncDBStatus = await syncDatabase()
  if (!syncDBStatus) {
    response.reason = '[Serverless DB Error]: Intialize failed.'
    return response
  }

  // 同步代码
  // 创建 文件夹
  try {
    fs.mkdirSync(unzipPath, { recursive: true })
  } catch (e) {}

  // 下载 wordpress 源码 zip 到指定目录
  async function downloadWpCode() {
    return new Promise((resolve, reject) => {
      const cosConfig = {
        SecretId: event.SecretId,
        SecretKey: event.SecretKey
      }
      if (event.Token) {
        cosConfig.XCosSecurityToken = event.Token
      }
      const cos = new COS(cosConfig)

      cos.getObject(
        {
          Region: event.WordPressCosRegion,
          Bucket: event.WordPressCosBucket,
          Key: event.WordPressCosPath,
          Output: fs.createWriteStream(downloadZipPath)
        },
        function(err) {
          if (err) {
            reject(err)
          }
          resolve(true)
        }
      )
    })
  }

  try {
    await downloadWpCode()
    await unzip(downloadZipPath, unzipPath)
    await copyDir(contentCopyPath, contentPath)
    response.status = 'success'

    console.log(`Sync wordpress code success`)
  } catch (e) {
    response.reason = `[Sync Code Error]: ${e.message}`
  }
  return response
}

module.exports.handler = handler
