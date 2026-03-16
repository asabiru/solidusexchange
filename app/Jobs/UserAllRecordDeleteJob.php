<?php

namespace App\Jobs;

use App\Models\Deposit;
use App\Models\Fund;
use App\Models\InAppNotification;
use App\Models\FireBaseToken;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\UserKyc;
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
        $user = User::withTrashed()->find($this->user->id);

        if (!$user) {
            return;
        }

        $this->deleteUserProfileImage($user);
        $this->deleteUserKycFiles($user->id);
        $this->deleteDepositFiles($user->id);
        $this->deleteFundFiles($user->id);
        $this->deleteSupportTickets($user->id);

        DB::transaction(function () use ($user) {
            UserKyc::query()->where('user_id', $user->id)->delete();
            DB::table('user_logins')->where('user_id', $user->id)->delete();
            Deposit::query()->where('user_id', $user->id)->delete();
            Fund::query()->where('user_id', $user->id)->delete();
            DB::table('transactions')->where('user_id', $user->id)->delete();
            DB::table('buy_requests')->where('user_id', $user->id)->delete();
            DB::table('exchange_requests')->where('user_id', $user->id)->delete();
            DB::table('sell_requests')->where('user_id', $user->id)->delete();
            FireBaseToken::query()
                ->where('tokenable_type', User::class)
                ->where('tokenable_id', $user->id)
                ->delete();
            InAppNotification::query()
                ->where('in_app_notificationable_type', User::class)
                ->where('in_app_notificationable_id', $user->id)
                ->delete();
            DB::table('support_tickets')->where('user_id', $user->id)->delete();

            $user->forceDelete();
        });
    }

    private function deleteUserProfileImage(User $user): void
    {
        $this->fileDelete($user->image_driver ?? 'local', $user->image);
    }

    private function deleteUserKycFiles(int $userId): void
    {
        UserKyc::query()->where('user_id', $userId)->get()->each(function (UserKyc $userKyc) {
            $this->deleteUploadedFields($userKyc->kyc_info);
        });
    }

    private function deleteDepositFiles(int $userId): void
    {
        Deposit::query()->where('user_id', $userId)->get()->each(function (Deposit $deposit) {
            $this->deleteUploadedFields($deposit->information);
        });
    }

    private function deleteFundFiles(int $userId): void
    {
        Fund::query()->where('user_id', $userId)->get()->each(function (Fund $fund) {
            $this->deleteUploadedFields($fund->information);
            $this->deleteUploadedFields($fund->detail);
        });
    }

    private function deleteSupportTickets(int $userId): void
    {
        SupportTicket::query()->where('user_id', $userId)->get()->each(function (SupportTicket $ticket) {
            $ticket->messages()->get()->each(function ($message) {
                $message->attachments()->get()->each(function ($attachment) {
                    $this->fileDelete($attachment->driver ?? 'local', $attachment->file);
                    $attachment->delete();
                });

                $message->delete();
            });

            $ticket->delete();
        });
    }

    private function deleteUploadedFields($payload): void
    {
        foreach ((array) $payload as $item) {
            $entry = (array) $item;

            if (($entry['type'] ?? null) === 'file' && !empty($entry['field_value'])) {
                $this->fileDelete($entry['field_driver'] ?? 'local', $entry['field_value']);
                continue;
            }

            if (($entry['type'] ?? null) === 'file' && !empty($entry['file'])) {
                $this->fileDelete($entry['driver'] ?? 'local', $entry['file']);
                continue;
            }

            foreach ($entry as $value) {
                if (is_array($value) || is_object($value)) {
                    $this->deleteUploadedFields($value);
                }
            }
        }
    }
}
