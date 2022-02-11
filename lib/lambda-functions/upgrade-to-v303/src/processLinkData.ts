export interface LinkDataToProcess {
  readonly oldlinkData: string;
  readonly artefactsBucketName: string;
  readonly linksTableName: string;
}

export const handler = async (event: LinkDataToProcess) => {
  const { oldlinkData, artefactsBucketName, linksTableName } = event;
  const processedOldLinkData = decodeURIComponent(oldlinkData.split("/")[1]);
  if (processedOldLinkData.endsWith(".ssofile")) {
    const keyValue = processedOldLinkData.split(".");
    return {
      oldlinkData: processedOldLinkData,
      awsEntityId: `${keyValue[0]}%${keyValue[1]}%${keyValue[2]}%${keyValue
        .slice(3, -2)
        .join(".")}%${keyValue[4]}%ssofile`,
      awsEntityType: keyValue[0],
      awsEntityData: keyValue[1],
      permissionSetName: keyValue[2],
      principalName: keyValue.slice(3, -2).join("."),
      principalType: keyValue[4],
      artefactsBucketName: artefactsBucketName,
      linksTableName: linksTableName,
      process: true,
    };
  } else {
    return {
      process: false,
      oldlinkData: processedOldLinkData,
      awsEntityId: "",
      awsEntityType: "",
      awsEntityData: "",
      permissionSetName: "",
      principalName: "",
      principalType: "",
      artefactsBucketName: artefactsBucketName,
      linksTableName: linksTableName,
    };
  }
};
