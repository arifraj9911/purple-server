import { Injectable, NotFoundException } from '@nestjs/common';
import { PostRepository } from './post.repository';
import { Post, Prisma } from '../../generated/prisma/client';

@Injectable()
export class PostService {
  constructor(private readonly postRepository: PostRepository) {}

  async createPost(data: {
    title: string;
    content?: string;
    authorEmail: string;
  }): Promise<Post> {
    const { title, content, authorEmail } = data;
    return this.postRepository.create({
      title,
      content,
      author: {
        connect: { email: authorEmail },
      },
    });
  }

  async getPostById(id: number): Promise<Post> {
    const post = await this.postRepository.findById(id);
    if (!post) {
      throw new NotFoundException(`Post with ID ${id} not found`);
    }
    return post;
  }

  async getPublishedPosts(): Promise<Post[]> {
    return this.postRepository.findMany({
      where: { published: true },
    });
  }

  async getFilteredPosts(searchString: string): Promise<Post[]> {
    return this.postRepository.findMany({
      where: {
        OR: [
          { title: { contains: searchString, mode: 'insensitive' } },
          { content: { contains: searchString, mode: 'insensitive' } },
        ],
      },
    });
  }

  async getAllPosts(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.PostWhereUniqueInput;
    where?: Prisma.PostWhereInput;
    orderBy?: Prisma.PostOrderByWithRelationInput;
  }): Promise<Post[]> {
    return this.postRepository.findMany(params);
  }

  async publishPost(id: number): Promise<Post> {
    // Check if post exists
    await this.getPostById(id);
    return this.postRepository.update({
      where: { id },
      data: { published: true },
    });
  }

  async updatePost(params: {
    where: Prisma.PostWhereUniqueInput;
    data: Prisma.PostUpdateInput;
  }): Promise<Post> {
    return this.postRepository.update(params);
  }

  async deletePost(id: number): Promise<Post> {
    // Check if post exists
    await this.getPostById(id);
    return this.postRepository.delete({ id });
  }
}
