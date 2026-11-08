terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

variable "region" {
  type    = string
  default = "us-west-2"
}

variable "name" {
  type    = string
  default = "nixed-build"
}

variable "compute_type" {
  type    = string
  default = "BUILD_GENERAL1_LARGE"
}

provider "aws" { region = var.region }
data "aws_caller_identity" "current" {}

locals {
  prefix = "${var.name}-${data.aws_caller_identity.current.account_id}-${var.region}"
}

resource "aws_s3_bucket" "source" { bucket = "${local.prefix}-source" }
resource "aws_s3_bucket" "cache" { bucket = "${local.prefix}-cache" }

resource "aws_s3_bucket_public_access_block" "private" {
  for_each                = { source = aws_s3_bucket.source.id, cache = aws_s3_bucket.cache.id }
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "encrypted" {
  for_each = { source = aws_s3_bucket.source.id, cache = aws_s3_bucket.cache.id }
  bucket   = each.value
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "source" {
  bucket = aws_s3_bucket.source.id
  rule {
    id     = "expire-snapshots"
    status = "Enabled"
    filter { prefix = "sources/" }
    expiration { days = 7 }
  }
}

# Only the secret container is managed here; key material never enters state.
resource "aws_secretsmanager_secret" "signing" { name = "${var.name}/signing-key" }
resource "aws_cloudwatch_log_group" "build" {
  name              = "/aws/codebuild/${var.name}"
  retention_in_days = 14
}

resource "aws_iam_role" "build" {
  name = var.name
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "codebuild.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "build" {
  role = aws_iam_role.build.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket", "s3:GetBucketLocation"], Resource = [aws_s3_bucket.source.arn, aws_s3_bucket.cache.arn] },
      { Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${aws_s3_bucket.source.arn}/sources/*"] },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${aws_s3_bucket.cache.arn}/*"] },
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.signing.arn] },
      { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = ["${aws_cloudwatch_log_group.build.arn}:*"] }
    ]
  })
}

resource "aws_codebuild_project" "package" {
  name                   = var.name
  service_role           = aws_iam_role.build.arn
  build_timeout          = 480
  queued_timeout         = 30
  concurrent_build_limit = 1
  artifacts { type = "NO_ARTIFACTS" }
  source {
    type      = "S3"
    location  = "${aws_s3_bucket.source.bucket}/sources/unset.zip"
    buildspec = "aws/buildspec.yml"
  }
  environment {
    compute_type    = var.compute_type
    image           = "aws/codebuild/standard:7.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = true
    environment_variable {
      name  = "CACHE_BUCKET"
      value = aws_s3_bucket.cache.bucket
    }
    environment_variable {
      name  = "SIGNING_SECRET"
      value = aws_secretsmanager_secret.signing.arn
    }
  }
  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.build.name
    }
  }
  depends_on = [aws_iam_role_policy.build]
}

output "region" { value = var.region }
output "source_bucket" { value = aws_s3_bucket.source.bucket }
output "cache_bucket" { value = aws_s3_bucket.cache.bucket }
output "project" { value = aws_codebuild_project.package.name }
output "signing_secret" { value = aws_secretsmanager_secret.signing.arn }
