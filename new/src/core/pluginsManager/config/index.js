const policy = {
  folderNameMustMatchSpecId: true,
};

const getPolicy = () => ({ ...policy });

const setFolderNameMustMatchSpecId = (value) => {
  policy.folderNameMustMatchSpecId = !!value;
};

module.exports = {
  getPolicy,
  setFolderNameMustMatchSpecId,
};
