<?php

namespace App\Support\B3;

use RuntimeException;

class B3Exception extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $httpStatus = 422,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    public static function make(string $code, string $message, int $status = 422): self
    {
        return new self($code, $message, $status);
    }
}
