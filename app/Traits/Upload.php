<?php

namespace App\Traits;

use Illuminate\Http\File;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Intervention\Image\Facades\Image;
use Throwable;


trait Upload
{
    public function makeDirectory($path)
    {
        if (file_exists($path)) return true;
        return mkdir($path, 0755, true);
    }

    public function removeFile($path)
    {
        return file_exists($path) && is_file($path) ? @unlink($path) : false;
    }


    public function fileUpload($file, $location, $fileName = null, $size = null, $encodedFormat = null, $encodedQuality = 90, $oldFileName = null, $oldDriver = 'local')
    {
        $activeDisk = config('filesystems.default');
        $path = null;

        if (!is_string($file)) {
            $file = $this->normalizeFile($file);
            if ($this->isImageFile($file)) {
                try {
                    $path = $this->makeImage($activeDisk, $file, $location, $size, $encodedFormat, $encodedQuality, $file->extension());
                } catch (Throwable $e) {
                    // Fallback when GD/Imagick or the requested codec is unavailable.
                    $path = $this->storeOriginalFile($activeDisk, $file, $location, $fileName);
                }
            } else {
                $path = $this->storeOriginalFile($activeDisk, $file, $location, $fileName);
            }
        } else {
            if ($this->isImageUrl($file)) {
                try {
                    $path = $this->makeImage($activeDisk, $file, $location, $size, $encodedFormat, $encodedQuality, pathinfo(parse_url($file, PHP_URL_PATH) ?: $file, PATHINFO_EXTENSION));
                } catch (Throwable $e) {
                    $path = $this->storeImageUrl($activeDisk, $file, $location, $fileName);
                }
            } else {
                Storage::disk($activeDisk)->put($location, $file);
                $path = $location;
            }
        }

        if (!empty($oldFileName) && $path && Storage::disk($oldDriver)->exists($oldFileName)) {
            Storage::disk($oldDriver)->delete($oldFileName);
        }

        return [
            'path' => $path,
            'driver' => $activeDisk,
        ];
    }

    protected function makeImage($activeDisk, $file, $location, $size, $encodedFormat, $encodedQuality, $fileExtension)
    {
        $image = Image::make($file);
        if (!empty($size)) {
            $size = explode('x', strtolower($size));
            $image->resize($size[0], $size[1]);
        }

        $extension = $encodedFormat ?: $fileExtension;
        $path = $location . '/' . Str::random(30) . '.' . $extension;
        Storage::disk($activeDisk)->put($path, !empty($encodedFormat) ? $image->encode($encodedFormat, $encodedQuality) : $image->encode());
        return $path;
    }

    protected function normalizeFile($file)
    {
        if ($file instanceof UploadedFile || $file instanceof File) {
            return $file;
        }

        return new File($file);
    }

    protected function isImageFile($file): bool
    {
        $mimeType = $file->getMimeType();
        return is_string($mimeType) && str_starts_with($mimeType, 'image/');
    }

    protected function storeOriginalFile($activeDisk, $file, $location, $fileName = null)
    {
        $name = $fileName;

        if (empty($name)) {
            $name = method_exists($file, 'hashName')
                ? $file->hashName()
                : Str::random(30) . '.' . $file->extension();
        }

        return Storage::disk($activeDisk)->putFileAs($location, $file, $name);
    }

    protected function storeImageUrl($activeDisk, $url, $location, $fileName = null)
    {
        $contents = @file_get_contents($url);
        if ($contents === false) {
            throw new \RuntimeException('Unable to fetch image.');
        }

        $pathInfo = pathinfo(parse_url($url, PHP_URL_PATH) ?: $url);
        $extension = $pathInfo['extension'] ?? 'jpg';
        $name = $fileName ?: Str::random(30) . '.' . $extension;
        $path = $location . '/' . $name;

        Storage::disk($activeDisk)->put($path, $contents);

        return $path;
    }

    protected function isImageUrl($url)
    {
        $imageInfo = @getimagesize($url);
        if ($imageInfo != false && str_starts_with($imageInfo['mime'], 'image/'))
            return true;

        return false;
    }

    public function fileDelete($driver = 'local', $old)
    {
        if (!empty($old)) {
            if (Storage::disk($driver)->exists($old)) {
                Storage::disk($driver)->delete($old);
            }
        }
        return 0;
    }
}

