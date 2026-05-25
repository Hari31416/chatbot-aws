STACK_NAME ?= chat
AWS_REGION ?= ap-south-1

export STACK_NAME
export AWS_REGION

.PHONY: deploy-backend deploy-frontend deploy-all create-bucket

deploy-backend:
	@echo "🚀 Starting isolated backend infrastructure deployment..."
	./deploy-backend.sh $(STACK_NAME)

deploy-frontend:
	@echo "🚀 Starting React frontend compilation and S3 assets sync..."
	./deploy-frontend.sh $(STACK_NAME)

deploy-all: deploy-backend deploy-frontend

create-bucket:
	@echo "🪣 Creating S3 bucket s3://chat-hari31416..."
	aws s3 mb s3://chat-hari31416
	@echo "🔓 Disabling S3 public access block config..."
	aws s3api put-public-access-block --bucket chat-hari31416 --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
	@echo "🌐 Configuring S3 static website hosting..."
	aws s3api put-bucket-website --bucket chat-hari31416 --website-configuration '{"IndexDocument":{"Suffix":"index.html"},"ErrorDocument":{"Key":"index.html"}}'
	@echo "📜 Applying public read bucket policy..."
	aws s3api put-bucket-policy --bucket chat-hari31416 --policy '{"Version":"2012-10-17","Statement":[{"Sid":"PublicReadGetObject","Effect":"Allow","Principal":"*","Action":"s3:GetObject","Resource":"arn:aws:s3:::chat-hari31416/*"}]}'
	@echo "🎉 Bucket s3://chat-hari31416 is created and configured as public static website!"

