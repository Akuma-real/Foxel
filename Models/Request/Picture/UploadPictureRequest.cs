using System.ComponentModel.DataAnnotations;
using Foxel.Models.DataBase;
using Foxel.Services.Attributes;

namespace Foxel.Models.Request.Picture;

public record UploadPictureRequest
{
    [Required] public IFormFile File { get; set; } = null!;

    public int? Permission { get; set; } = 1;

    public int? AlbumId { get; set; } = null;
    
    public StorageType? StorageType { get; set; } = null;
}