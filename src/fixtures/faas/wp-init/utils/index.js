const AdmZip = require('adm-zip')
const path = require('path')
const fs = require('fs')

function resolve(filename) {
  return path.resolve(process.cwd(), filename)
}

function isDir(filename) {
  try {
    const stat = fs.statSync(filename)
    return stat.isDirectory()
  } catch (e) {
    return false
  }
}

function mkdir(dirPath) {
  if (!isDir(dirPath)) {
    fs.mkdirSync(dirPath, { recursize: true })
  }
  return true
}

function unzip(input, output = process.cwd()) {
  const inputPath = resolve(input)
  const zip = new AdmZip(inputPath)
  const outputPath = resolve(output)
  mkdir(outputPath)

  zip.extractAllTo(outputPath, true)
}

async function sleep(ms) {
  return new Promise((res) => {
    setTimeout(() => {
      res(true)
    }, ms)
  })
}

module.exports = {
  sleep,
  unzip
}
