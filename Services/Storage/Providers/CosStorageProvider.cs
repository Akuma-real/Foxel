using COSXML;
using COSXML.Auth;
using COSXML.CosException;
using COSXML.Model.Object;
using COSXML.Model.Tag;
using COSXML.Transfer;
using Foxel.Services.Attributes;
using Foxel.Services.Configuration;
using Microsoft.Extensions.Logging;

namespace Foxel.Services.Storage.Providers;

public class CustomQCloudCredentialProvider : DefaultSessionQCloudCredentialProvider
{
    private readonly IConfigService _configService;
    private readonly ILogger<CustomQCloudCredentialProvider> _logger;

    public CustomQCloudCredentialProvider(IConfigService configService, ILogger<CustomQCloudCredentialProvider> logger) 
        : base(null, null, 0L, null)
    {
        _configService = configService;
        _logger = logger;
        Refresh();
    }

    public sealed override void Refresh()
    {
        try
        {
            string tmpSecretId = _configService["Storage:CosStorageSecretId"];
            string tmpSecretKey = _configService["Storage:CosStorageSecretKey"];
            string tmpToken = _configService["Storage:CosStorageToken"]; 
            long tmpStartTime = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            long tmpExpiredTime = tmpStartTime + 7200;
            SetQCloudCredential(tmpSecretId, tmpSecretKey,
                $"{tmpStartTime};{tmpExpiredTime}", tmpToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "刷新临时密钥时出错");
            throw;
        }
    }
}

[StorageProvider(StorageType.Cos)]
public class CosStorageProvider(IConfigService configService, ILogger<CosStorageProvider> logger) : IStorageProvider
{
    private CosXml CreateClient()
    {
        var config = new CosXmlConfig.Builder()
            .IsHttps(true) 
            .SetRegion(configService["Storage:CosStorageRegion"])
            .SetDebugLog(true) 
            .Build();
            
        var cosCredentialProvider = new CustomQCloudCredentialProvider(configService, 
            logger.IsEnabled(LogLevel.Debug) ? 
                Microsoft.Extensions.Logging.LoggerFactory.Create(builder => builder.AddConsole()).CreateLogger<CustomQCloudCredentialProvider>() :
                Microsoft.Extensions.Logging.Abstractions.NullLogger<CustomQCloudCredentialProvider>.Instance);
        
        return new CosXmlServer(config, cosCredentialProvider);
    }

    public async Task<string> SaveAsync(Stream fileStream, string fileName, string contentType)
    {
        try
        {
            // 创建唯一的文件存储路径
            string currentDate = DateTime.Now.ToString("yyyy/MM");
            string ext = Path.GetExtension(fileName);
            string objectKey = $"{currentDate}/{Guid.NewGuid()}{ext}";

            // 创建临时文件
            string tempPath = Path.GetTempFileName();
            try
            {
                await using (var fileStream2 = new FileStream(tempPath, FileMode.Create))
                {
                    await fileStream.CopyToAsync(fileStream2);
                }

                var cosXmlClient = CreateClient();
                var transferConfig = new TransferConfig();
                var transferManager = new TransferManager(cosXmlClient, transferConfig);
                var uploadTask = new COSXMLUploadTask(configService["Storage:CosStorageBucketName"], objectKey);
                uploadTask.SetSrcPath(tempPath);
                await transferManager.UploadAsync(uploadTask);
                return objectKey;
            }
            finally
            {
                // 确保临时文件被删除
                if (File.Exists(tempPath))
                {
                    File.Delete(tempPath);
                }
            }
        }
        catch (CosClientException clientEx)
        {
            logger.LogError(clientEx, "COS客户端异常");
            throw;
        }
        catch (CosServerException serverEx)
        {
            logger.LogError(serverEx, "COS服务器异常: {ServerInfo}", serverEx.GetInfo());
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "上传文件到腾讯云COS时出错");
            throw;
        }
    }

    public async Task DeleteAsync(string storagePath)
    {
        try
        {
            if (string.IsNullOrEmpty(storagePath))
                return;

            var cosXmlClient = CreateClient();
            var request = new DeleteObjectRequest(configService["Storage:CosStorageBucketName"], storagePath);
            await Task.Run(() => cosXmlClient.DeleteObject(request));
        }
        catch (CosClientException clientEx)
        {
            logger.LogWarning(clientEx, "COS客户端异常");
        }
        catch (CosServerException serverEx)
        {
            logger.LogWarning(serverEx, "COS服务器异常: {ServerInfo}", serverEx.GetInfo());
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "从腾讯云COS删除文件时出错");
        }
    }

    public string GetUrl(string storagePath)
    {
        try
        {
            if (string.IsNullOrEmpty(storagePath))
                return "/images/unavailable.gif";

            string cdnUrl = configService["Storage:CosStorageCdnUrl"];
            string bucketName = configService["Storage:CosStorageBucketName"];
            string region = configService["Storage:CosStorageRegion"];
            bool isPublicRead = bool.TryParse(configService["Storage:CosStoragePublicRead"], out var publicRead) && publicRead;

            // 优先使用CDN
            if (!string.IsNullOrEmpty(cdnUrl))
                return $"{cdnUrl}/{storagePath}";

            // 公开读取的桶可直接访问
            if (isPublicRead)
                return $"https://{bucketName}.cos.{region}.myqcloud.com/{storagePath}";

            var cosXmlClient = CreateClient();
            var bucketParts = bucketName.Split('-');
            var request = new PreSignatureStruct
            {
                bucket = bucketParts[0],
                appid = bucketParts[1],
                region = region,
                key = storagePath,
                httpMethod = "GET",
                isHttps = true,
                signDurationSecond = 3600 * 24  
            };
            
            var url = cosXmlClient.GenerateSignURL(request);
            return url;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "生成腾讯云COS文件URL时出错");
            return "/images/unavailable.gif";
        }
    }

    public async Task<string> DownloadFileAsync(string storagePath)
    {
        try
        {
            if (string.IsNullOrEmpty(storagePath))
            {
                throw new ArgumentException("存储路径不能为空");
            }

            // 创建临时目录
            var tempDir = Path.Combine(Path.GetTempPath(), "FoxelCosTemp");
            if (!Directory.Exists(tempDir))
            {
                Directory.CreateDirectory(tempDir);
            }

            string bucketName = configService["Storage:CosStorageBucketName"];
            string fileName = Path.GetFileName(storagePath);
            
            var cosXmlClient = CreateClient();
            var transferConfig = new TransferConfig();
            var transferManager = new TransferManager(cosXmlClient, transferConfig);
            var downloadTask = new COSXMLDownloadTask(bucketName, storagePath, tempDir, fileName);
            await transferManager.DownloadAsync(downloadTask);
            return Path.Combine(tempDir, fileName);
        }
        catch (CosClientException clientEx)
        {
            logger.LogError(clientEx, "COS客户端异常");
            throw;
        }
        catch (CosServerException serverEx)
        {
            logger.LogError(serverEx, "COS服务器异常: {ServerInfo}", serverEx.GetInfo());
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "从腾讯云COS下载文件时出错");
            throw;
        }
    }
}
