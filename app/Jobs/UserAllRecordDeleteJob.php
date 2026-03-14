<?php

namespace App\Jobs;

use App\Models\ApiClient;
use App\Models\EmailTemplate;
use App\Models\SupportTicket;
use App\Traits\Upload;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;

class UserAllRecordDeleteJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels, Upload;

    public $user;

    /**
     * Create a new job instance.
     */
    public function __construct($user)
    {
        $this->user = $user;
    }

    /**
     * Execute the job.
     */
    public function handle(): void
    {
        DB::table('user_kycs')->where('user_id', $this->user->id)->delete();
        DB::table('user_logins')->where('user_id', $this->user->id)->delete();
        DB::table('deposits')->where('user_id', $this->user->id)->delete();
        DB::table('funds')->where('user_id', $this->user->id)->delete();
        DB::table('transactions')->where('user_id', $this->user->id)->delete();
        DB::table('buy_requests')->where('user_id', $this->user->id)->delete();
        DB::table('exchange_requests')->where('user_id', $this->user->id)->delete();
        DB::table('sell_requests')->where('user_id', $this->user->id)->delete();

        SupportTicket::where('user_id', $this->user->id)->get()->map(function ($item) {
            $item->messages()->get()->map(function ($message) {
                if (count($message->attachments) > 0) {
                    foreach ($message->attachments as $img) {
                        $this->fileDelete($img->driver, $img->file);
                        $img->delete();
                    }
                }
            });
            $item->messages()->delete();
            $item->delete();
        });
    }
}
