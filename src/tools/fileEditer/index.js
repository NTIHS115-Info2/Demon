module.exports = {
    GetFileContent: require('./impl/readFile').GetFileContent,
    GetFilesContent: require('./impl/readDir').GetFilesContent,
    writeFile_Cover: require('./impl/coverFile').writeFile_Cover,
    writeFile_Append: require('./impl/appendFile').writeFile_Append,
    checkFile: require('./utils/checkFile').checkFile
}