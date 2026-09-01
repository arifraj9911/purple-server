import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { PostService } from './post.service';
import { Post as PostEntity } from '../../generated/prisma/client';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';

@ApiTags('Posts')
@Controller('posts')
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Get('feed')
  @ApiOperation({ summary: 'Get published posts feed' })
  @ApiResponse({ status: 200, description: 'List of published posts.' })
  async getFeed(): Promise<PostEntity[]> {
    return this.postService.getPublishedPosts();
  }

  @Get('filter/:searchString')
  @ApiOperation({ summary: 'Search posts by title or content' })
  @ApiParam({ name: 'searchString', description: 'Search query string', type: String })
  @ApiResponse({ status: 200, description: 'List of matched posts.' })
  async getFilteredPosts(
    @Param('searchString') searchString: string,
  ): Promise<PostEntity[]> {
    return this.postService.getFilteredPosts(searchString);
  }

  @Get('filtered-posts/:searchString')
  @ApiOperation({ summary: 'Search posts alias' })
  @ApiParam({ name: 'searchString', description: 'Search query string', type: String })
  @ApiResponse({ status: 200, description: 'List of matched posts.' })
  async getFilteredPostsAlias(
    @Param('searchString') searchString: string,
  ): Promise<PostEntity[]> {
    return this.postService.getFilteredPosts(searchString);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get post by ID' })
  @ApiParam({ name: 'id', description: 'Post ID', type: Number })
  @ApiResponse({ status: 200, description: 'Post found.' })
  @ApiResponse({ status: 404, description: 'Post not found.' })
  async getPostById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PostEntity> {
    return this.postService.getPostById(id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all posts' })
  @ApiResponse({ status: 200, description: 'List of all posts.' })
  async getAllPosts(): Promise<PostEntity[]> {
    return this.postService.getAllPosts();
  }

  @Post()
  @ApiOperation({ summary: 'Create a new post draft' })
  @ApiResponse({ status: 201, description: 'The post has been created.' })
  @ApiResponse({ status: 400, description: 'Invalid input data.' })
  async createPost(
    @Body() createPostDto: CreatePostDto,
  ): Promise<PostEntity> {
    return this.postService.createPost(createPostDto);
  }

  @Put('publish/:id')
  @ApiOperation({ summary: 'Publish a post by ID' })
  @ApiParam({ name: 'id', description: 'Post ID', type: Number })
  @ApiResponse({ status: 200, description: 'The post has been published.' })
  @ApiResponse({ status: 404, description: 'Post not found.' })
  async publishPost(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PostEntity> {
    return this.postService.publishPost(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a post by ID' })
  @ApiParam({ name: 'id', description: 'Post ID', type: Number })
  @ApiResponse({ status: 200, description: 'The post has been updated.' })
  @ApiResponse({ status: 404, description: 'Post not found.' })
  async updatePost(
    @Param('id', ParseIntPipe) id: number,
    @Body() updatePostDto: UpdatePostDto,
  ): Promise<PostEntity> {
    return this.postService.updatePost({
      where: { id },
      data: updatePostDto,
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a post by ID' })
  @ApiParam({ name: 'id', description: 'Post ID', type: Number })
  @ApiResponse({ status: 200, description: 'The post has been deleted.' })
  @ApiResponse({ status: 404, description: 'Post not found.' })
  async deletePost(@Param('id', ParseIntPipe) id: number): Promise<PostEntity> {
    return this.postService.deletePost(id);
  }
}
