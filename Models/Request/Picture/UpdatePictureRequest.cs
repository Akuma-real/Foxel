namespace Foxel.Models.Request.Picture;

public record UpdatePictureRequest
{
    public string? Name { get; set; }
    public string? Description { get; set; }
    public List<string>? Tags { get; set; }
}
