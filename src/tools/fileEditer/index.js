module.exports = {
    GetFileContent: require('./impl/readFile').GetFileContent,
    GetFilesContent: require('./impl/ReadDir').GetFilesContent,
    writeFile_Cover: require('./impl/coverFile').writeFile_Cover,
    writeFile_Append: require('./impl/appendfile').writeFile_Append,
    checkFile: require('./utils/checkFile').checkFile
}